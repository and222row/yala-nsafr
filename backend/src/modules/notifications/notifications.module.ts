import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FirebaseService } from './firebase.service';
import { User } from '../../database/entities/user.entity';
import { AppNotification } from '../../database/entities/notification.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, AppNotification])],
  providers: [FirebaseService, NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
