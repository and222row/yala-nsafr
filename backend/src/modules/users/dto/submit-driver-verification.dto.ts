import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitDriverVerificationDto {
  @IsOptional()
  @IsString()
  drivingLicenceNumber?: string;

  @IsOptional()
  @IsString()
  drivingLicencePhotoUrl?: string;

  @IsString()
  vehicleMake: string;

  @IsString()
  vehicleModel: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1990)
  @Max(new Date().getFullYear() + 1)
  vehicleYear: number;

  @IsString()
  vehicleColor: string;

  @IsString()
  vehiclePlate: string;

  @IsOptional()
  @IsString()
  vehiclePhotoUrl?: string;
}
