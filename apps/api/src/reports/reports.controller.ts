import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fixly/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateReportDto) {
    return this.reportsService.create(user.id, input);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  list() {
    return this.reportsService.listOpen();
  }

  @Patch(':id/resolve')
  @Roles(UserRole.ADMIN)
  resolve(@Param('id', ParseUUIDPipe) id: string) {
    return this.reportsService.resolve(id);
  }
}
