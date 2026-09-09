import { IsDateString } from 'class-validator';

export class ScheduleBookingDto {
  @IsDateString()
  scheduledAt!: string;
}
