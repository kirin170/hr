import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { PublicRoute } from './auth/auth.decorators.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @PublicRoute()
  getHello(): string {
    return this.appService.getHello();
  }
}
