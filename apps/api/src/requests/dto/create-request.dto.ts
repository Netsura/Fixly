import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateRequestDto {
  @IsUUID()
  serviceId!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(5000)
  description!: string;

  @IsString()
  @MaxLength(128)
  locationHash!: string;

  @IsDateString()
  preferredStart!: string;

  @IsDateString()
  preferredEnd!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMinCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMaxCents?: number;
}
