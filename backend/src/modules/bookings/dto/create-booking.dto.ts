import { IsUUID, IsNumber, IsEnum, IsOptional, Min, Max, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../database/entities/booking.entity';

export class CreateBookingDto {
  @IsUUID()
  tripId: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(4)
  seatsCount: number;

  /** Ignored — all bookings are now cash only */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsBoolean()
  usePromo?: boolean;
}
