FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80

# API_URL defaults to http://backend:8000 for local docker-compose.
# On Render/Railway, set API_URL to the backend's public URL.
ENV API_URL=http://backend:8000

# nginx:alpine auto-runs envsubst on /etc/nginx/templates/*.template
# and outputs to /etc/nginx/conf.d/ before starting nginx.
CMD ["nginx", "-g", "daemon off;"]
