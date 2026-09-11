import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('notifications')
@Index('idx_notifications_user_created', ['userId', 'createdAt'])
export class AppNotification {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id' }) userId: string;

  @Column({ length: 200 }) title: string;

  @Column({ length: 1000 }) body: string;

  @Column({ type: 'jsonb', nullable: true }) data: Record<string, string> | null;

  @Column({ default: false }) read: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
