import { IsString, IsDateString, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class SearchTripsDto {
  @IsString()
  originCity: string;

  @IsString()
  destinationCity: string;

  @IsDateString()
  departureDate: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  seats?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  womenOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  smokingAllowed?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  petsAllowed?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 20;
}
