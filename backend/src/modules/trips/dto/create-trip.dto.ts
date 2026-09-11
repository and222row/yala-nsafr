import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsDateString,
  Min,
  Max,
  IsEnum,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum LuggageSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

export enum ChatPreference {
  SILENT = 'silent',
  FRIENDLY = 'friendly',
  TALKATIVE = 'talkative',
}

export class CreateTripDto {
  @IsString()
  @MinLength(2)
  originCity: string;

  @IsOptional()
  @IsString()
  originAddress?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  originLat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  originLng?: number;

  @IsString()
  @MinLength(2)
  destinationCity: string;

  @IsOptional()
  @IsString()
  destinationAddress?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  destinationLat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  destinationLng?: number;

  @IsDateString()
  departureTime: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(8)
  totalSeats: number;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  pricePerSeat: number;

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
