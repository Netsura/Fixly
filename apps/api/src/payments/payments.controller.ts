import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreatePaymentDto, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.paymentsService.createPaymentIntent(user.id, input.bookingId, idempotencyKey);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getPayment(user.id, id);
  }

  @Post('webhook')
  async webhook(@Req() request: RawBodyRequest<Request>, @Res() response: Response, @Headers('stripe-signature') signature?: string) {
    const result = await this.paymentsService.handleWebhook(request.rawBody as Buffer, signature);
    return response.status(200).json(result);
  }
}
