import { IsUUID, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitRatingDto {
  @IsUUID()
  bookingId: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
