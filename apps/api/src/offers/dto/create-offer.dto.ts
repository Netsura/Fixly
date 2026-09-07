import { IsDateString, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateOfferDto {
  @IsInt()
  @Min(1)
  priceCents!: number;

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsDateString()
  availableAt!: string;
}
