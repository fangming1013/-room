# 硅基流动 AI 生图代理镜像（零依赖 Node，key 仅来自环境变量）
FROM node:20-slim
WORKDIR /app
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "img-proxy.js"]
