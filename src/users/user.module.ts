import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { AuthModule } from './auth.module';
import { UserController } from './user.controller';
import { UsersGrpcController } from './users.grpc.controller';
import { UserService } from './service/user.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [UserController, UsersGrpcController],
  providers: [UserService],
})
export class UserModule {}
