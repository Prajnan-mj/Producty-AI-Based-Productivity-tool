FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

ENV API_URL=""

# Inline entrypoint: write config.js with the runtime API_URL, then start nginx.
# No external shell script = no CRLF line-ending bugs from Windows.
CMD ["/bin/sh", "-c", "echo \"window.__PRODUCTY_CONFIG__ = { API_URL: \\\"${API_URL}\\\" };\" > /usr/share/nginx/html/config.js && nginx -g 'daemon off;'"]
