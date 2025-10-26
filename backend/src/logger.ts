import pino from 'pino';
import { config } from './config.js';

const isProd = config.nodeEnv === 'production';

export const logger = pino({
  level: config.logLevel,
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          singleLine: true,
        },
      },
});

export default logger;

