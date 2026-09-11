import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsDateString,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LuggageSize, ChatPreference } from './create-trip.dto';

export class UpdateTripDto {
  @IsOptional()
  @IsDateString()
  departureTime?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(8)
  totalSeats?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  pricePerSeat?: number;

  @IsOptional()
  @IsBoolean()
  womenOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  smokingAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  petsAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  airConditioning?: boolean;

  @IsOptional()
  @IsEnum(LuggageSize)
  luggageSize?: LuggageSize;

  @IsOptional()
  @IsEnum(ChatPreference)
  chatPreference?: ChatPreference;

  @IsOptional()
  @IsString()
  notes?: string;
}
