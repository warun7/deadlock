import winston from 'winston';
import path from 'path';
import fs from 'fs';

// File logging is opt-out. In a container, logs belong on stdout/stderr where
// the platform collects them -- writing to files inside a container hides them
// from `docker compose logs` and grows unbounded. Keep files for local dev.
const logToFile = process.env.LOG_TO_FILE !== 'false';

// Ensure logs directory exists (only needed when file logging is enabled)
const logsDir = path.join(process.cwd(), 'logs');
if (logToFile && !fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Build transports: console is ALWAYS present so container logs are never
// empty. Production gets structured JSON; development gets colourised output.
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? fileFormat : consoleFormat,
  }),
];

if (logToFile) {
  transports.push(
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  defaultMeta: { service: 'deadlock-server' },
  transports,
});

// Create child loggers for different modules
export const createModuleLogger = (moduleName: string) => {
  return logger.child({ module: moduleName });
};

export default logger;

