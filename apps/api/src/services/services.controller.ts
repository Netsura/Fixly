import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListServicesQuery } from './dto/list-services.query';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  list(@Query() query: ListServicesQuery) {
    return this.servicesService.list(query);
  }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.servicesService.findBySlug(slug);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.findOne(id);
  }
}
