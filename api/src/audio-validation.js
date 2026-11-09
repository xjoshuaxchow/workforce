export function validMp3(bytes) {
  let at = 0,
    frames = 0;
  if (bytes.subarray(0, 3).toString() === "ID3") {
    if (
      bytes.length < 10 ||
      bytes[3] < 2 ||
      bytes[3] > 4 ||
      [6, 7, 8, 9].some((i) => bytes[i] & 128)
    )
      return false;
    const size =
      (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    at = 10 + size + (bytes[3] === 4 && bytes[5] & 16 ? 10 : 0);
    if (at >= bytes.length) return false;
  }
  while (at < bytes.length) {
    if (
      bytes.length - at === 128 &&
      bytes.toString("ascii", at, at + 3) === "TAG"
    ) {
      at = bytes.length;
      break;
    }
    if (
      at + 4 > bytes.length ||
      bytes[at] !== 255 ||
      (bytes[at + 1] & 224) !== 224
    )
      return false;
    const version = (bytes[at + 1] >> 3) & 3,
      layer = (bytes[at + 1] >> 1) & 3,
      index = bytes[at + 2] >> 4,
      rateIndex = (bytes[at + 2] >> 2) & 3;
    if (
      version === 1 ||
      layer !== 1 ||
      index === 0 ||
      index === 15 ||
      rateIndex === 3
    )
      return false;
    const rates = [44100, 48000, 32000],
      bitRates =
        version === 3
          ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
          : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const rate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4),
      length =
        Math.floor(
          ((version === 3 ? 144000 : 72000) * bitRates[index]) / rate,
        ) +
        ((bytes[at + 2] >> 1) & 1);
    if (length < 4 || at + length > bytes.length) return false;
    at += length;
    frames++;
  }
  return frames >= 2 && at === bytes.length;
}
