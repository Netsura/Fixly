import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BookingsService } from './bookings.service';
import { ScheduleBookingDto } from './dto/schedule-booking.dto';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bookingsService.list(user.id, user.role);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.findOne(user.id, user.role, id);
  }

  @Patch(':id/schedule')
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ScheduleBookingDto,
  ) {
    return this.bookingsService.schedule(user.id, user.role, id, input);
  }

  @Patch(':id/start')
  start(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.start(user.id, user.role, id);
  }

  @Patch(':id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.complete(user.id, user.role, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.cancel(user.id, user.role, id);
  }
}
