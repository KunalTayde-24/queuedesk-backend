import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

interface CleanErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const body: CleanErrorBody =
        typeof exceptionResponse === 'string'
          ? {
              statusCode: status,
              message: exceptionResponse,
              error: exception.name,
            }
          : {
              statusCode: status,
              message: (exceptionResponse as Record<string, unknown>)
                .message as string | string[],
              error:
                ((exceptionResponse as Record<string, unknown>).error as
                  string | undefined) ?? exception.name,
            };

      response.status(status).json(body);
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }
}
