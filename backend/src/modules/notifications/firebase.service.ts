import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, initializeApp, cert } from 'firebase-admin/app';
import { Messaging, getMessaging } from 'firebase-admin/messaging';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    const privateKey = this.config.get<string>('FCM_PRIVATE_KEY');
    const clientEmail = this.config.get<string>('FCM_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn('Firebase credentials not configured — push notifications are disabled (stub mode)');
      return;
    }

    this.app = initializeApp({
      credential: cert({
        projectId,
        privateKey: privateKey.replace(/\\n/g, '\n'),
        clientEmail,
      }),
    });

    this.logger.log(`Firebase Admin initialised for project: ${projectId}`);
  }

  get messaging(): Messaging | null {
    return this.app ? getMessaging(this.app) : null;
  }

  get isReady(): boolean {
    return this.app !== null;
  }
}
