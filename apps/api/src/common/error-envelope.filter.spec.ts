import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { codeForStatus, ErrorEnvelopeFilter } from './error-envelope.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'req-1' }),
    }),
  };
  new ErrorEnvelopeFilter().catch(exception, host as never);
  return { status: status.mock.calls[0]?.[0] as number, body: json.mock.calls[0]?.[0] };
}

describe('ErrorEnvelopeFilter', () => {
  it('wraps HttpException with code, message and requestId', () => {
    const { status, body } = run(new NotFoundException('No such category'));
    expect(status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No such category',
        details: undefined,
        requestId: 'req-1',
      },
    });
  });

  it('puts validation messages into details', () => {
    const { status, body } = run(new BadRequestException(['pincode must be valid']));
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual(['pincode must be valid']);
  });

  it('maps Prisma unique violations to 409 CONFLICT', () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { status, body } = run(err);
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('hides internals of unknown errors', () => {
    const { status, body } = run(new Error('connection string postgres://secret@db failed'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps 429 to RATE_LIMITED', () => {
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
  });
});
