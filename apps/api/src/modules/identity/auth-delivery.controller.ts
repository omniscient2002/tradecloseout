import { Controller, Post, Req, HttpCode, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { Pool } from 'pg';
import { AuthDeliveryLedger, parseAuthDeliveryReceipt, verifyAuthDeliverySignature } from '@tradecloseout/db';

@Controller('api/v1/auth/delivery')
export class AuthDeliveryController {
  constructor(private readonly pool:Pool) {}

  // Provider authentication is a timestamped HMAC over the exact raw bytes,
  // independent of cookies, member permissions and browser CSRF exceptions.
  @Post('receipts')
  @HttpCode(204)
  async receipt(@Req() req:RawBodyRequest<Request>):Promise<void> {
    if(!req.rawBody || !verifyAuthDeliverySignature(req.rawBody,
      req.headers['x-auth-delivery-timestamp'],req.headers['x-auth-delivery-signature'])) {
      throw new ForbiddenException({code:'AUTH_DELIVERY_SIGNATURE_INVALID'});
    }
    let receipt;
    try {receipt=parseAuthDeliveryReceipt(JSON.parse(req.rawBody.toString('utf8')));}
    catch {throw new BadRequestException({code:'AUTH_DELIVERY_RECEIPT_INVALID'});}
    try {await new AuthDeliveryLedger(this.pool).receipt(receipt);}
    catch(error){
      if(error instanceof Error && error.message.startsWith('AUTH_DELIVERY_RECEIPT_')) {
        throw new ConflictException({code:'AUTH_DELIVERY_RECEIPT_UNCORRELATED'});
      }
      throw error;
    }
  }
}
