FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY ams/package*.json ./
RUN npm ci
COPY ams/ ./
RUN npm run build
FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
