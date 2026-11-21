import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import mongoSanitize from 'express-mongo-sanitize';

import routes from './routes/index.js';
import { errorHandler } from './middleware/errorMiddleware.js';
import { ApiError } from './utils/ApiError.js';
import { ERROR_CODES } from './constants/responseCodes.js';
import { env } from './config/env.js';

import { observabilityMiddleware } from './middleware/observabilityMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const possibleDistPaths = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
];
const activeDistPath = possibleDistPaths.find((p) => fs.existsSync(p)) || null;

if (activeDistPath) {
  console.log(`[Frontend] Serving static frontend from: ${activeDistPath}`);
} else {
  console.warn('[Frontend Warning] No client/dist directory found to serve statically.');
}

const app = express();

app.use(observabilityMiddleware);

// Security Headers
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS configuration - allow Render, localhost, custom domains, and reflect origin
const allowedClientUrls = (env.CLIENT_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin direct asset requests)
      if (!origin) {
        return callback(null, true);
      }
      // Allow localhost and local loopbacks
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // Allow any onrender.com origin
      if (/\.onrender\.com$/.test(origin)) {
        return callback(null, true);
      }
      // Allow explicitly configured CLIENT_URL
      if (allowedClientUrls.includes(origin) || origin === env.CLIENT_URL) {
        return callback(null, true);
      }
      // In production, permit requests from web browsers gracefully
      return callback(null, true);
    },
    credentials: true,
  })
);

// Body Parsing & Cookie Parser
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

// Request Logging
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Global Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
    errorCode: ERROR_CODES.BAD_REQUEST,
  },
});
app.use('/api', limiter);

// Base API Routes
app.use('/api', routes);

// Serve Static Frontend Assets in Production
if (activeDistPath) {
  app.use(express.static(activeDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(activeDistPath, 'index.html'));
  });
}

// 404 Handler for API
app.use((req, res, next) => {
  next(new ApiError(404, `Route ${req.originalUrl} not found`, ERROR_CODES.NOT_FOUND));
});

// Central Error Handler
app.use(errorHandler);

export default app;
