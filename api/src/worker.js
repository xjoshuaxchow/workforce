import { runJobs } from "./messaging.js";
import { mutate, audit } from "./service.js";
export function startWorker({
  pool,
  clock = () => new Date(),
  interval = 1000,
  pstn = null,
  whatsapp = null,
}) {
  let stopped = false,
    timer,
    pending,
    nextComplete = 0;
  const tick = async () => {
    try {
      await runJobs(pool, clock, { pstn, whatsapp });
      if (clock().getTime() >= nextComplete) {
        await mutate(pool, clock, async (db) => {
          const before = (
            await db.query(
              "SELECT * FROM shifts WHERE status IN ('published','confirmed') AND end_at<=$1 ORDER BY id FOR UPDATE SKIP LOCKED",
              [clock()],
            )
          ).rows;
          for (const shift of before) {
            const row = (
              await db.query(
                "UPDATE shifts SET status='completed' WHERE id=$1 RETURNING *",
                [shift.id],
              )
            ).rows[0];
            await audit(
              db,
              clock,
              { actor_type: "system", id: null },
              "shift.completed",
              "shift",
              row.id,
              shift,
              row,
              row.site_id,
            );
          }
        });
        nextComplete = clock().getTime() + 300000;
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "worker.tick_failed",
          message: error.message,
        }),
      );
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          pending = tick();
        }, interval);
    }
  };
  pending = tick();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await pending;
  };
}
