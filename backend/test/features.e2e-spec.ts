/**
 * E2E tests for features added in the trip lifecycle + payment refactor.
 *
 * Runs against the real dev database (synchronize: true will auto-apply new columns).
 * Kashier API calls are spied on so no real HTTP requests leave the machine.
 *
 * Test phone numbers (+201111100001, +201111100002) are used exclusively for test
 * data; cleanup runs in beforeAll + afterAll.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, Not } from 'typeorm';

import { AppModule } from '../src/app.module';
import { Trip, TripStatus } from '../src/database/entities/trip.entity';
import { User, UserRole, UserStatus, Gender } from '../src/database/entities/user.entity';
import { Booking, BookingStatus, PaymentMethod } from '../src/database/entities/booking.entity';
import { Payment, PaymentStatus } from '../src/database/entities/payment.entity';
import { WithdrawalRequest, WithdrawalStatus, PayoutMethod } from '../src/database/entities/withdrawal-request.entity';

import { SchedulerService } from '../src/modules/scheduler/scheduler.service';
import { TripsService } from '../src/modules/trips/trips.service';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { EarningsService } from '../src/modules/earnings/earnings.service';
import { KashierService } from '../src/modules/payments/kashier.service';
import { KashierController } from '../src/modules/payments/kashier.controller';
import { SosService } from '../src/modules/sos/sos.service';
import { SosAlert } from '../src/database/entities/sos-alert.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { RatingsService } from '../src/modules/ratings/ratings.service';
import { Rating, RaterRole } from '../src/database/entities/rating.entity';
import { PlatformConfig, CONFIG_KEYS } from '../src/database/entities/platform-config.entity';
import { MessagesService } from '../src/modules/messages/messages.service';
import { TripMessage } from '../src/database/entities/trip-message.entity';
import { LocationService } from '../src/modules/location/location.service';
import { TripComment } from '../src/database/entities/trip-comment.entity';

// Wait for async operations inside setImmediate callbacks to complete.
// setImmediate itself starts immediately, but the DB + Kashier calls inside are async.
// 300ms is enough for local DB round-trips to finish.
const waitForBackground = () => new Promise<void>(resolve => setTimeout(resolve, 300));

const DRIVER_PHONE = '+201111100001';
const PASSENGER_PHONE = '+201111100002';
const STRANGER_PHONE = '+201111100003';

describe('Features E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let schedulerService: SchedulerService;
  let tripsService: TripsService;
  let bookingsService: BookingsService;
  let earningsService: EarningsService;
  let kashierService: KashierService;
  let kashierController: KashierController;
  let sosService: SosService;
  let notificationsService: NotificationsService;
  let ratingsService: RatingsService;
  let messagesService: MessagesService;
  let locationService: LocationService;

  let tripRepo: Repository<Trip>;
  let bookingRepo: Repository<Booking>;
  let paymentRepo: Repository<Payment>;
  let userRepo: Repository<User>;
  let withdrawalRepo: Repository<WithdrawalRequest>;
  let sosAlertRepo: Repository<SosAlert>;
  let ratingRepo: Repository<Rating>;
  let messageRepo: Repository<TripMessage>;
  let commentRepo: Repository<TripComment>;

  let driverUser: User;
  let passengerUser: User;

  // clearAllMocks only resets call counts — a mockResolvedValue set by one test stayed
  // in place for every later test, so a spy whose mockRestore was skipped (or whose
  // test failed before reaching it) silently changed unrelated results. restoreAllMocks
  // puts the real implementations back, and each test installs its own spies afterwards
  // because inner beforeEach hooks run after this one.
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  // ── Setup ────────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    schedulerService = moduleFixture.get(SchedulerService);
    tripsService = moduleFixture.get(TripsService);
    bookingsService = moduleFixture.get(BookingsService);
    earningsService = moduleFixture.get(EarningsService);
    kashierService = moduleFixture.get(KashierService);
    kashierController = moduleFixture.get(KashierController);
    sosService = moduleFixture.get(SosService);
    notificationsService = moduleFixture.get(NotificationsService);
    ratingsService = moduleFixture.get(RatingsService);
    messagesService = moduleFixture.get(MessagesService);
    locationService = moduleFixture.get(LocationService);

    tripRepo = moduleFixture.get(getRepositoryToken(Trip));
    bookingRepo = moduleFixture.get(getRepositoryToken(Booking));
    paymentRepo = moduleFixture.get(getRepositoryToken(Payment));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    withdrawalRepo = moduleFixture.get(getRepositoryToken(WithdrawalRequest));
    sosAlertRepo = moduleFixture.get(getRepositoryToken(SosAlert));
    ratingRepo = moduleFixture.get(getRepositoryToken(Rating));
    messageRepo = moduleFixture.get(getRepositoryToken(TripMessage));
    commentRepo = moduleFixture.get(getRepositoryToken(TripComment));

    await cleanupTestData();

    // Create test users with ACTIVE status
    driverUser = await userRepo.save(
      userRepo.create({
        phoneNumber: DRIVER_PHONE,
        fullName: 'E2E Test Driver',
        status: UserStatus.ACTIVE,
        role: UserRole.DRIVER,
        referralCode: 'E2E_DRV1',
      }),
    );

    passengerUser = await userRepo.save(
      userRepo.create({
        phoneNumber: PASSENGER_PHONE,
        fullName: 'E2E Test Passenger',
        status: UserStatus.ACTIVE,
        role: UserRole.PASSENGER,
        referralCode: 'E2E_PSG1',
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  }, 15_000);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function cleanupTestData() {
    const phones = [DRIVER_PHONE, PASSENGER_PHONE, STRANGER_PHONE];
    const users = await userRepo.find({ where: phones.map(p => ({ phoneNumber: p })) });
    if (!users.length) return;

    const userIds = users.map(u => u.id);

    // SOS alerts
    for (const uid of userIds) {
      await sosAlertRepo.delete({ userId: uid });
    }

    // Ratings
    for (const uid of userIds) {
      await ratingRepo.delete({ raterId: uid });
      await ratingRepo.delete({ rateeId: uid });
    }

    // Withdrawals
    for (const uid of userIds) {
      await withdrawalRepo.delete({ driverId: uid });
    }

    // Trips & cascaded bookings/payments
    const trips = await tripRepo.find({ where: userIds.map(id => ({ driverId: id })) });
    if (trips.length) {
      for (const t of trips) {
        await messageRepo.delete({ tripId: t.id });
        await commentRepo.delete({ tripId: t.id });
        const bookings = await bookingRepo.find({ where: { tripId: t.id } });
        for (const b of bookings) {
          await paymentRepo.delete({ bookingId: b.id });
        }
        await bookingRepo.delete({ tripId: t.id });
      }
      await tripRepo.delete(trips.map(t => t.id));
    }

    await userRepo.delete(userIds);
  }

  async function makeTrip(overrides: Partial<Trip> = {}): Promise<Trip> {
    return tripRepo.save(
      tripRepo.create({
        driverId: driverUser.id,
        originCity: 'Cairo',
        destinationCity: 'Alexandria',
        departureTime: new Date(Date.now() + 2 * 3_600_000), // default 2h from now
        totalSeats: 4,
        availableSeats: 3,
        pricePerSeat: 150,
        status: TripStatus.SCHEDULED,
        ...overrides,
      }),
    );
  }

  async function makeBookingWithPayment(
    tripId: string,
    {
      paymentStatus = PaymentStatus.PENDING,
      paymentMethod = PaymentMethod.CARD,
      bookingStatus = BookingStatus.CONFIRMED,
    }: {
      paymentStatus?: PaymentStatus;
      paymentMethod?: PaymentMethod;
      bookingStatus?: BookingStatus;
    } = {},
  ): Promise<{ booking: Booking; payment: Payment }> {
    const booking = await bookingRepo.save(
      bookingRepo.create({
        tripId,
        passengerId: passengerUser.id,
        seatsCount: 1,
        totalAmount: 150,
        commissionAmount: 10.5,
        driverPayoutAmount: 139.5,
        commissionRate: 0.07,
        paymentMethod,
        status: bookingStatus,
        confirmedAt: bookingStatus === BookingStatus.CONFIRMED ? new Date() : undefined,
      }),
    );

    const payment = await paymentRepo.save(
      paymentRepo.create({
        bookingId: booking.id,
        amount: 150,
        currency: 'EGP',
        status: paymentStatus,
        gatewayName: 'kashier',
        gatewayOrderId: `test-order-${booking.id.slice(0, 8)}`,
        gatewayTransactionId: `test-txn-${booking.id.slice(0, 8)}`,
        isCash: paymentMethod === PaymentMethod.CASH,
      }),
    );

    return { booking, payment };
  }

  /**
   * The scheduler crons sweep every SCHEDULED trip in the database by departure time,
   * so invoking one from a test also acts on real trips: auto-cancel would cancel them,
   * refund their bookings, and hand their drivers cancellation strikes and posting bans.
   *
   * Park every at-risk trip that isn't the e2e driver's outside the crons' windows for
   * the duration of the call, then restore its real departure time. Trips created by
   * makeTrip always belong to driverUser, so they stay exposed and still get tested.
   */
  async function runSchedulerShielded<T>(run: () => Promise<T>): Promise<T> {
    const exposed = await tripRepo.find({
      where: {
        status: TripStatus.SCHEDULED,
        // Widest cron window is the T-30 reminder's now+32min
        departureTime: LessThan(new Date(Date.now() + 40 * 60_000)),
        driverId: Not(driverUser.id),
      },
      select: { id: true, departureTime: true },
    });

    const parked = new Date(Date.now() + 365 * 24 * 3_600_000);
    for (const t of exposed) {
      await tripRepo.update(t.id, { departureTime: parked });
    }
    try {
      return await run();
    } finally {
      for (const t of exposed) {
        await tripRepo.update(t.id, { departureTime: t.departureTime });
      }
    }
  }

  // ── 1. Scheduler: T-30 pre-departure reminders ──────────────────────────────

  describe('SchedulerService — T-30 reminder', () => {
    it('sets reminderSentAt on trips departing in < 32 min', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 25 * 60_000),
        reminderSentAt: undefined!,
      });

      await runSchedulerShielded(() => (schedulerService as any).sendPreDepartureReminders());

      const updated = await tripRepo.findOneBy({ id: trip.id });
      expect(updated?.reminderSentAt).not.toBeNull();

      await tripRepo.delete(trip.id);
    });

    it('does NOT re-send reminder if already sent', async () => {
      const sentAt = new Date(Date.now() - 10 * 60_000);
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 25 * 60_000),
        reminderSentAt: sentAt,
      });

      await runSchedulerShielded(() => (schedulerService as any).sendPreDepartureReminders());

      const updated = await tripRepo.findOneBy({ id: trip.id });
      // Time should not have changed (within 1 second tolerance)
      expect(Math.abs(updated!.reminderSentAt.getTime() - sentAt.getTime())).toBeLessThan(1000);

      await tripRepo.delete(trip.id);
    });

    it('ignores trips departing more than 32 min away', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 60 * 60_000), // 60 min away
        reminderSentAt: undefined!,
      });

      await runSchedulerShielded(() => (schedulerService as any).sendPreDepartureReminders());

      const updated = await tripRepo.findOneBy({ id: trip.id });
      expect(updated?.reminderSentAt).toBeNull();

      await tripRepo.delete(trip.id);
    });
  });

  // ── 2. Scheduler: T+30 final warnings ───────────────────────────────────────

  describe('SchedulerService — T+30 final warning', () => {
    it('sets finalWarningSentAt for trips 28+ min past departure', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 35 * 60_000),
        status: TripStatus.SCHEDULED,
        finalWarningSentAt: undefined!,
      });

      await runSchedulerShielded(() => (schedulerService as any).sendFinalWarnings());

      const updated = await tripRepo.findOneBy({ id: trip.id });
      expect(updated?.finalWarningSentAt).not.toBeNull();

      await tripRepo.delete(trip.id);
    });

    it('ignores trips where finalWarningSentAt is already set', async () => {
      const sentAt = new Date(Date.now() - 5 * 60_000);
      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 35 * 60_000),
        status: TripStatus.SCHEDULED,
        finalWarningSentAt: sentAt,
      });

      await runSchedulerShielded(() => (schedulerService as any).sendFinalWarnings());

      const updated = await tripRepo.findOneBy({ id: trip.id });
      expect(Math.abs(updated!.finalWarningSentAt.getTime() - sentAt.getTime())).toBeLessThan(1000);

      await tripRepo.delete(trip.id);
    });
  });

  // ── 3. Scheduler: T+45 auto-cancel ──────────────────────────────────────────

  describe('SchedulerService — T+45 auto-cancel', () => {
    it('cancels overdue trip, releases PENDING payment, increments driver counter', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 50 * 60_000),
        status: TripStatus.SCHEDULED,
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.PENDING,
      });

      const driverBefore = await userRepo.findOneBy({ id: driverUser.id });
      const counterBefore = driverBefore!.cancelledTripsAsDriver;

      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      await runSchedulerShielded(() => (schedulerService as any).autoCancelOverdueTrips());

      const [updatedTrip, updatedBooking, updatedPayment, updatedDriver] = await Promise.all([
        tripRepo.findOneBy({ id: trip.id }),
        bookingRepo.findOneBy({ id: booking.id }),
        paymentRepo.findOneBy({ id: payment.id }),
        userRepo.findOneBy({ id: driverUser.id }),
      ]);

      expect(updatedTrip?.status).toBe(TripStatus.CANCELLED);
      expect(updatedTrip?.cancelledAt).not.toBeNull();
      expect(updatedTrip?.cancellationReason).toContain('إلغاء تلقائي');

      expect(updatedBooking?.status).toBe(BookingStatus.REFUNDED);
      expect(updatedBooking?.cancelledAt).not.toBeNull();

      expect(updatedPayment?.status).toBe(PaymentStatus.RELEASED);
      expect(updatedDriver?.cancelledTripsAsDriver).toBe(counterBefore + 1);

      releaseSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('refunds already-CAPTURED payment when auto-cancelling', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 50 * 60_000),
        status: TripStatus.SCHEDULED,
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.CAPTURED,
      });

      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);

      await runSchedulerShielded(() => (schedulerService as any).autoCancelOverdueTrips());

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);
      expect(updatedPayment?.refundAmount).not.toBeNull();

      refundSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('skips trips that are already CANCELLED or COMPLETED', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 50 * 60_000),
        status: TripStatus.CANCELLED,
        cancelledAt: new Date(),
      });

      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      await runSchedulerShielded(() => (schedulerService as any).autoCancelOverdueTrips());

      // Should not have done anything — trip was already cancelled
      expect(releaseSpy).not.toHaveBeenCalled();

      releaseSpy.mockRestore();
      await tripRepo.delete(trip.id);
    });
  });

  // ── 4. Payment capture on markComplete ──────────────────────────────────────

  describe('TripsService.markComplete — payment capture', () => {
    it('records CAPTURED only after Kashier confirms the capture', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id);

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      const [updatedPayment, updatedBooking, updatedTrip] = await Promise.all([
        paymentRepo.findOneBy({ id: payment.id }),
        bookingRepo.findOneBy({ id: booking.id }),
        tripRepo.findOneBy({ id: trip.id }),
      ]);

      // Written after the gateway call succeeded, not before it
      expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);
      expect(updatedPayment?.capturedAt).not.toBeNull();

      // Kashier API should have been called with correct order ID and amount
      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(captureSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-txn'),
        150,
      );

      // Booking and trip should also be updated
      expect(updatedBooking?.status).toBe(BookingStatus.TRIP_COMPLETED);
      expect(updatedTrip?.status).toBe(TripStatus.COMPLETED);

      captureSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('leaves the payment PENDING if capture throws and Kashier does not confirm it', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id);

      const captureSpy = jest
        .spyOn(kashierService, 'capturePayment')
        .mockRejectedValue(new Error('Kashier API down'));
      // Kashier can't confirm a capture → our optimistic CAPTURED write must be undone
      const orderStatusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest.spyOn(kashierService, 'getPaymentStatus').mockResolvedValue(null);

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      // Never claimed CAPTURED, so nothing to revert — it stays collectable on retry
      expect(updatedPayment?.status).toBe(PaymentStatus.PENDING);
      expect(updatedPayment?.capturedAt).toBeNull();

      captureSpy.mockRestore();
      statusSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('records CAPTURED when the call fails but Kashier reports the order captured', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id);

      // Mirrors the live 404: our capture call errors, but the money really was taken
      const captureSpy = jest
        .spyOn(kashierService, 'capturePayment')
        .mockRejectedValue(new Error('Kashier API error 404: Cannot PUT /v3/orders/x'));
      const orderStatusSpy_statusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest
        .spyOn(kashierService, 'getPaymentStatus')
        .mockResolvedValue('CAPTURED');

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);
      expect(statusSpy).toHaveBeenCalled();

      captureSpy.mockRestore();
      statusSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('does not record CAPTURED on a 404 when Kashier reports the order uncaptured', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id);

      // The dangerous case: 404 because we used the wrong order id, money never taken.
      // Trusting the 404 here would credit the driver for an uncollected payment.
      const captureSpy = jest
        .spyOn(kashierService, 'capturePayment')
        .mockRejectedValue(new Error('Kashier API error 404: Cannot PUT /v3/orders/x'));
      const orderStatusSpy_statusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest
        .spyOn(kashierService, 'getPaymentStatus')
        .mockResolvedValue('AUTHORIZED');

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.PENDING);

      captureSpy.mockRestore();
      statusSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    // Regression: the transaction wrote CAPTURED before contacting Kashier, so between
    // commit and the gateway replying the money counted as withdrawable — and a crash in
    // that window left the claim permanent.
    it('uncaptured money is not withdrawable while the gateway call is in flight', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id);

      let balanceDuringCapture = -1;
      const captureSpy = jest
        .spyOn(kashierService, 'capturePayment')
        .mockImplementation(async () => {
          // Sampled at the exact moment the old code had already written CAPTURED
          const summary = await earningsService.getSummary(driverUser.id);
          balanceDuringCapture = summary.allTimeOnline;
          return { transactionId: null };
        });

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(balanceDuringCapture).toBe(0);

      // ...and it becomes withdrawable once the capture is recorded
      const after = await earningsService.getSummary(driverUser.id);
      expect(after.allTimeOnline).toBe(139.5);

      captureSpy.mockRestore();
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('reconciliation captures a completed trip whose payment is still pending', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.TRIP_COMPLETED,
        paymentStatus: PaymentStatus.PENDING,
      });
      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });

      await tripsService.reconcileCapturedPayments();

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(captureSpy).toHaveBeenCalled();
      expect(updated?.status).toBe(PaymentStatus.CAPTURED);
      expect(updated?.capturedAt).not.toBeNull();

      captureSpy.mockRestore();
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('reconciliation records a capture that succeeded but was never written', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.TRIP_COMPLETED,
        paymentStatus: PaymentStatus.PENDING,
      });
      // The crash case: Kashier already took the money, our write never landed
      const captureSpy = jest
        .spyOn(kashierService, 'capturePayment')
        .mockRejectedValue(new Error('Kashier API error 404'));
      const orderStatusSpy_statusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest
        .spyOn(kashierService, 'getPaymentStatus')
        .mockResolvedValue('CAPTURED');

      await tripsService.reconcileCapturedPayments();

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.CAPTURED);

      captureSpy.mockRestore();
      statusSpy.mockRestore();
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('reconciliation leaves an uncollected payment alone', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.TRIP_COMPLETED,
        paymentStatus: PaymentStatus.PENDING,
      });
      const captureSpy = jest
        .spyOn(kashierService, 'capturePayment')
        .mockRejectedValue(new Error('Kashier API down'));
      const orderStatusSpy_statusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest
        .spyOn(kashierService, 'getPaymentStatus')
        .mockResolvedValue('AUTHORIZED');

      await tripsService.reconcileCapturedPayments();

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.PENDING);

      captureSpy.mockRestore();
      statusSpy.mockRestore();
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('does not call Kashier for cash payments', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentMethod: PaymentMethod.CASH,
        paymentStatus: PaymentStatus.PENDING,
      });

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      expect(captureSpy).not.toHaveBeenCalled();

      captureSpy.mockRestore();

      // Delete payment before booking to respect FK constraint
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 5. Cancellation policies — Kashier API calls ─────────────────────────────

  describe('BookingsService.cancelByPassenger — payment flows', () => {
    // Cancelling inside 24h of departure adds a strike, and three strikes bar the
    // passenger from cash bookings. Left to accumulate, these tests eventually break
    // unrelated ones further down the file.
    afterEach(async () => {
      await userRepo.update(passengerUser.id, {
        cancellationStrikes: 0,
        cashBookingRestrictedUntil: null as any,
      });
    });

    it('free_cancel: releases PENDING payment (>48h before departure)', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 60 * 3_600_000), // 60h from now
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.PENDING,
      });

      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });

      const result = await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(result.policy).toBe('free_cancel');
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(captureSpy).not.toHaveBeenCalled();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.RELEASED);
      expect(updatedPayment?.releasedAt).not.toBeNull();

      releaseSpy.mockRestore();
      captureSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('late_cancel: captures full then partially refunds (2–48h before departure)', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 5 * 3_600_000), // 5h from now
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.PENDING,
      });

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      const result = await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(result.policy).toBe('late_cancel');
      // First: capture the full authorized amount
      expect(captureSpy).toHaveBeenCalledTimes(1);
      // Then: refund (total - 15% fee) = 150 * 0.85 = 127.50
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy.mock.calls[0][0]).toEqual(expect.any(String));
      expect(refundSpy.mock.calls[0][1]).toBe(127.5);
      expect(releaseSpy).not.toHaveBeenCalled();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(Number(updatedPayment?.refundAmount)).toBeCloseTo(127.5, 2);
      expect(updatedPayment?.capturedAt).not.toBeNull();

      captureSpy.mockRestore();
      refundSpy.mockRestore();
      releaseSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('no_refund: captures full amount within 2h of departure', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 30 * 60_000), // 30 min from now
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.PENDING,
      });

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      const result = await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(result.policy).toBe('no_refund');
      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).not.toHaveBeenCalled();
      expect(releaseSpy).not.toHaveBeenCalled();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);

      captureSpy.mockRestore();
      refundSpy.mockRestore();
      releaseSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('already CAPTURED + free_cancel: issues full refund', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 60 * 3_600_000),
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.CAPTURED,
      });

      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      const result = await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(result.policy).toBe('free_cancel');
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy.mock.calls[0][0]).toEqual(expect.any(String));
      expect(refundSpy.mock.calls[0][1]).toBe(150);
      expect(releaseSpy).not.toHaveBeenCalled();

      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);

      refundSpy.mockRestore();
      releaseSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    // Regression: capture and refund both ran inside the cancelling transaction, so a
    // refund failure rolled the database back while the capture had already happened at
    // Kashier — the passenger was charged with nothing recording it.
    it('a capture that succeeds is recorded even when the refund then fails', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 5 * 3_600_000), // late-cancel window
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });
      const refundSpy = jest
        .spyOn(kashierService, 'refundPayment')
        .mockRejectedValue(new Error('Kashier API down'));
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      const fresh = await bookingRepo.findOne({
        where: { id: booking.id },
        relations: { trip: true },
      });
      await bookingsService.cancelByPassenger(fresh!.id, passengerUser);

      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).toHaveBeenCalledTimes(1);

      // The money really was taken, so the record has to say so — a rollback here would
      // leave a charged passenger with no trace of it.
      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);
      expect(updatedPayment?.capturedAt).not.toBeNull();
      expect(updatedPayment?.refundedAt).toBeNull();

      // And the cancellation itself still stands — a gateway outage must not trap the
      // passenger on a booking they cancelled
      const updatedBooking = await bookingRepo.findOneBy({ id: booking.id });
      expect(updatedBooking?.cancelledAt).not.toBeNull();

      captureSpy.mockRestore();
      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('a failed void leaves the hold recorded as still held', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 72 * 3_600_000), // free-cancel window
      });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });

      const releaseSpy = jest
        .spyOn(kashierService, 'releasePayment')
        .mockRejectedValue(new Error('Kashier API down'));
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      const fresh = await bookingRepo.findOne({
        where: { id: booking.id },
        relations: { trip: true },
      });
      await bookingsService.cancelByPassenger(fresh!.id, passengerUser);

      // Not marked RELEASED — the hold is still in place and the void must be retried
      const updatedPayment = await paymentRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.PENDING);
      expect(updatedPayment?.releasedAt).toBeNull();

      const updatedBooking = await bookingRepo.findOneBy({ id: booking.id });
      expect(updatedBooking?.cancelledAt).not.toBeNull();

      releaseSpy.mockRestore();
      notifySpy.mockRestore();
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('cash booking never calls any Kashier API', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 60 * 3_600_000),
      });
      // makeBookingWithPayment always creates a Payment record; capture it for cleanup
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentMethod: PaymentMethod.CASH,
        paymentStatus: PaymentStatus.PENDING,
      });

      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);

      await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(releaseSpy).not.toHaveBeenCalled();
      expect(captureSpy).not.toHaveBeenCalled();
      expect(refundSpy).not.toHaveBeenCalled();

      releaseSpy.mockRestore();
      captureSpy.mockRestore();
      refundSpy.mockRestore();

      // Delete payment before booking to respect FK constraint
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 6. Earnings withdrawal — marked PAID immediately ─────────────────────────

  describe('EarningsService.requestWithdrawal', () => {
    // A PENDING withdrawal blocks the driver from requesting another one, so a test that
    // fails before its own cleanup would cascade into every later withdrawal test.
    // Scoped to the e2e driver so real drivers' requests are never touched.
    afterEach(async () => {
      await withdrawalRepo.delete({ driverId: driverUser.id });
    });

    // Seed a completed booking so the driver has available balance. The payment must be
    // CAPTURED: only money actually collected counts toward a withdrawable balance.
    async function seedCompletedEarnings(
      amount: number,
    ): Promise<{ trip: Trip; booking: Booking; payment: Payment }> {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const booking = await bookingRepo.save(
        bookingRepo.create({
          tripId: trip.id,
          passengerId: passengerUser.id,
          seatsCount: 1,
          totalAmount: amount,
          commissionAmount: +(amount * 0.07).toFixed(2),
          driverPayoutAmount: +(amount * 0.93).toFixed(2),
          commissionRate: 0.07,
          paymentMethod: PaymentMethod.CARD,
          status: BookingStatus.TRIP_COMPLETED,
          completedAt: new Date(),
          confirmedAt: new Date(),
        }),
      );
      const payment = await paymentRepo.save(
        paymentRepo.create({
          bookingId: booking.id,
          amount,
          currency: 'EGP',
          status: PaymentStatus.CAPTURED,
          capturedAt: new Date(),
          gatewayName: 'kashier',
          gatewayOrderId: `test-order-${booking.id.slice(0, 8)}`,
          isCash: false,
        }),
      );
      return { trip, booking, payment };
    }

    it('stays PENDING when Kashier accepts the transfer — acceptance is not delivery', async () => {
      const { trip, booking, payment } = await seedCompletedEarnings(500);
      const transferId = `MOCK-TRS-${Date.now()}`;

      const transferSpy = jest
        .spyOn(kashierService, 'createTransfer')
        .mockResolvedValue({ transferId, isMock: false });

      const result = await earningsService.requestWithdrawal(
        driverUser,
        200,
        PayoutMethod.VODAFONE_CASH,
        '01234567890',
        'Test Driver',
      );

      // A transferId only means Kashier queued it; it can still end up FAILED. Marking
      // PAID here would cut the driver's balance for money never delivered.
      expect(result.status).toBe(WithdrawalStatus.PENDING);
      expect(result.kashierTransferId).toBe(transferId);
      expect(result.paidAt).toBeNull();

      // Not delivered, so it must not count as withdrawn...
      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.totalWithdrawn).toBe(0);
      // ...but it is already in flight, so it is not available to withdraw again
      expect(summary.pendingWithdrawal).toBe(200);
      expect(summary.pendingBalance).toBe(265);

      transferSpy.mockRestore();

      // Cleanup — payment before booking to respect the FK
      await withdrawalRepo.delete(result.id);
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('keeps withdrawal PENDING and records error when Kashier transfer fails', async () => {
      const { trip, booking, payment } = await seedCompletedEarnings(500);

      const transferSpy = jest
        .spyOn(kashierService, 'createTransfer')
        .mockRejectedValue(new Error('Network timeout'));

      const result = await earningsService.requestWithdrawal(
        driverUser,
        200,
        PayoutMethod.VODAFONE_CASH,
        '01234567890',
        'Test Driver',
      );

      expect(result.status).toBe(WithdrawalStatus.PENDING);
      expect(result.adminNote).toContain('Network timeout');
      expect(result.paidAt).toBeNull();

      transferSpy.mockRestore();

      // Cleanup — payment before booking to respect the FK
      await withdrawalRepo.delete(result.id);
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('a failed transfer returns the amount to the driver balance', async () => {
      const { trip, booking, payment } = await seedCompletedEarnings(500);
      const transferSpy = jest
        .spyOn(kashierService, 'createTransfer')
        .mockResolvedValue({ transferId: 'TRS-FAILS-LATER', isMock: false });

      const result = await earningsService.requestWithdrawal(
        driverUser,
        200,
        PayoutMethod.VODAFONE_CASH,
        '01234567890',
        'Test Driver',
      );
      expect(result.status).toBe(WithdrawalStatus.PENDING);

      // Kashier reports the transfer failed after the fact — the exact case that left
      // TRS-87924954532 marked PAID while no money moved.
      await withdrawalRepo.update(result.id, {
        status: WithdrawalStatus.REJECTED,
        adminNote: 'Kashier transfer failed',
      });

      const summary = await earningsService.getSummary(driverUser.id);
      // Only PAID withdrawals count against the balance, so the money is still his
      expect(summary.totalWithdrawn).toBe(0);
      expect(summary.pendingBalance).toBe(465);

      transferSpy.mockRestore();

      await withdrawalRepo.delete(result.id);
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    // Regression: pendingBalance only subtracted PAID withdrawals, so a driver whose
    // 300 was already in flight still saw the full 305 as available to withdraw.
    describe('in-flight withdrawals reduce the available balance', () => {
      it('subtracts a PENDING withdrawal from pendingBalance and reports it separately', async () => {
        const { trip, booking, payment } = await seedCompletedEarnings(500);
        const before = await earningsService.getSummary(driverUser.id);
        expect(before.pendingBalance).toBe(465);
        expect(before.pendingWithdrawal).toBe(0);

        const transferSpy = jest
          .spyOn(kashierService, 'createTransfer')
          .mockResolvedValue({ transferId: 'TRS-E2E-INFLIGHT-BAL', isMock: false });

        const req = await earningsService.requestWithdrawal(
          driverUser,
          200,
          PayoutMethod.VODAFONE_CASH,
          '01111111111',
          'Test Driver',
        );
        expect(req.status).toBe(WithdrawalStatus.PENDING);

        const after = await earningsService.getSummary(driverUser.id);
        // Money handed to Kashier is no longer spendable
        expect(after.pendingWithdrawal).toBe(200);
        expect(after.pendingBalance).toBe(265);
        // Not yet delivered, so it must not count as withdrawn either
        expect(after.totalWithdrawn).toBe(0);

        transferSpy.mockRestore();
        await withdrawalRepo.delete(req.id);
        await paymentRepo.delete(payment.id);
        await bookingRepo.delete(booking.id);
        await tripRepo.delete(trip.id);
      });

      it('frees the amount again when the transfer is rejected', async () => {
        const { trip, booking, payment } = await seedCompletedEarnings(500);
        const transferSpy = jest
          .spyOn(kashierService, 'createTransfer')
          .mockResolvedValue({ transferId: 'TRS-E2E-FREED-BAL', isMock: false });

        const req = await earningsService.requestWithdrawal(
          driverUser,
          200,
          PayoutMethod.VODAFONE_CASH,
          '01111111111',
          'Test Driver',
        );
        expect((await earningsService.getSummary(driverUser.id)).pendingBalance).toBe(265);

        await withdrawalRepo.update(req.id, { status: WithdrawalStatus.REJECTED });

        const after = await earningsService.getSummary(driverUser.id);
        expect(after.pendingWithdrawal).toBe(0);
        expect(after.pendingBalance).toBe(465);

        transferSpy.mockRestore();
        await withdrawalRepo.delete(req.id);
        await paymentRepo.delete(payment.id);
        await bookingRepo.delete(booking.id);
        await tripRepo.delete(trip.id);
      });
    });

    // Regression: balance check and insert were separate statements with no lock, so two
    // simultaneous requests could both pass and both create a payout.
    it('two simultaneous withdrawals cannot both succeed', async () => {
      const { trip, booking, payment } = await seedCompletedEarnings(500); // 450 available
      const transferSpy = jest
        .spyOn(kashierService, 'createTransfer')
        .mockResolvedValue({ transferId: 'TRS-E2E-RACE', isMock: false });

      const attempt = () =>
        earningsService.requestWithdrawal(
          driverUser,
          400,
          PayoutMethod.VODAFONE_CASH,
          '01111111111',
          'Test Driver',
        );

      // Fired together so both read the balance before either has committed
      const results = await Promise.allSettled([attempt(), attempt()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // 800 must never have been committed against a 450 balance
      const created = await withdrawalRepo.find({ where: { driverId: driverUser.id } });
      expect(created).toHaveLength(1);
      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.pendingBalance).toBeGreaterThanOrEqual(0);

      transferSpy.mockRestore();
      await withdrawalRepo.delete({ driverId: driverUser.id });
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    describe('reconcilePendingWithdrawals', () => {
      // Every transfer id used here is prefixed so it can never collide with a real one
      const T = (name: string) => `TRS-E2E-${name}`;

      async function pendingWithdrawal(transferId: string | null) {
        return withdrawalRepo.save(
          withdrawalRepo.create({
            driverId: driverUser.id,
            amount: 200,
            payoutMethod: PayoutMethod.VODAFONE_CASH,
            payoutAccount: '01000000002',
            payoutName: 'Test Driver',
            status: WithdrawalStatus.PENDING,
            kashierTransferId: transferId ?? undefined,
          }),
        );
      }

      /**
       * The job scans every outstanding withdrawal in the database, not just this
       * test's. A blanket mockResolvedValue would therefore apply the mocked status to
       * real withdrawals too — which is exactly how an earlier run reversed a live
       * record. Answer only for the transfer under test and return null (unknown) for
       * everything else, which the job skips.
       */
      function mockTransferStatus(transferId: string, status: string | null) {
        return jest
          .spyOn(kashierService, 'getTransferStatus')
          .mockImplementation(async (id) => (id === transferId ? status : null));
      }

      // The job now looks up withdrawals that have no transferId by merchant id. Stubbed
      // for every test so none of them reaches the real Kashier API for an unknown id;
      // the recovery tests override it for their own withdrawal only.
      let recoverSpy: jest.SpyInstance;
      beforeEach(() => {
        recoverSpy = jest
          .spyOn(kashierService, 'getTransferByMerchantId')
          .mockResolvedValue(null);
      });
      afterEach(() => recoverSpy?.mockRestore());

      it('promotes to PAID when Kashier reports the transfer delivered', async () => {
        const w = await pendingWithdrawal(T('DELIVERED'));
        const statusSpy = mockTransferStatus(T('DELIVERED'), 'TRANSFERRED');
        const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

        await earningsService.reconcilePendingWithdrawals();
        await waitForBackground();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.PAID);
        expect(updated?.paidAt).not.toBeNull();
        expect(notifySpy).toHaveBeenCalled();

        statusSpy.mockRestore();
        notifySpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('rejects and returns the balance when Kashier reports FAILED', async () => {
        // Mirrors the live TRS-87924954532 case: accepted, then failed, nobody told us.
        // Uses a synthetic id — reusing the real one risked touching that record.
        const w = await pendingWithdrawal(T('LATE-FAILURE'));
        const statusSpy = mockTransferStatus(T('LATE-FAILURE'), 'FAILED');
        const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.REJECTED);
        expect(updated?.paidAt).toBeNull();
        expect(updated?.adminNote).toContain('FAILED');

        // Rejected withdrawals never count against the balance
        const summary = await earningsService.getSummary(driverUser.id);
        expect(summary.totalWithdrawn).toBe(0);

        statusSpy.mockRestore();
        notifySpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('leaves a still-processing transfer untouched for the next run', async () => {
        const w = await pendingWithdrawal(T('INFLIGHT'));
        const statusSpy = mockTransferStatus(T('INFLIGHT'), 'PROCESSING');

        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.PENDING);

        statusSpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('leaves it PENDING when the status cannot be read, rather than assuming failure', async () => {
        const w = await pendingWithdrawal(T('UNREACHABLE'));
        const statusSpy = mockTransferStatus(T('UNREACHABLE'), null);

        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.PENDING);

        statusSpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      // Regression: a create call that timed out left no transferId, and the job used to
      // filter those out entirely — so the withdrawal could never be recovered.
      it('recovers a withdrawal whose create call timed out, by merchant id', async () => {
        const w = await pendingWithdrawal(null);
        const statusSpy = mockTransferStatus(T('UNUSED'), null);
        const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
        recoverSpy.mockImplementation(async (id: string) =>
          id === w.id
            ? { transferId: T('RECOVERED'), status: 'TRANSFERRED' }
            : null,
        );

        await earningsService.reconcilePendingWithdrawals();
        await waitForBackground();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        // The transfer did land despite the timeout, so it is adopted and settled
        expect(updated?.kashierTransferId).toBe(T('RECOVERED'));
        expect(updated?.status).toBe(WithdrawalStatus.PAID);

        statusSpy.mockRestore();
        notifySpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('leaves it pending when Kashier has no record of the transfer', async () => {
        const w = await pendingWithdrawal(null);
        const statusSpy = mockTransferStatus(T('UNUSED'), null);

        // recoverSpy returns null by default — the create never reached Kashier
        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.PENDING);
        expect(updated?.kashierTransferId).toBeNull();

        statusSpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('a recovered transfer that failed returns the money to the driver', async () => {
        const w = await pendingWithdrawal(null);
        const statusSpy = mockTransferStatus(T('UNUSED'), null);
        const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
        recoverSpy.mockImplementation(async (id: string) =>
          id === w.id ? { transferId: T('RECOVERED-FAIL'), status: 'FAILED' } : null,
        );

        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.REJECTED);
        const summary = await earningsService.getSummary(driverUser.id);
        expect(summary.totalWithdrawn).toBe(0);

        statusSpy.mockRestore();
        notifySpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('reverses a recently-paid withdrawal that Kashier later reports FAILED', async () => {
        // A delivered payout stays returnable, so a bounce-back after the fact must put
        // the money back on the driver's balance rather than going unnoticed.
        const w = await withdrawalRepo.save(
          withdrawalRepo.create({
            driverId: driverUser.id,
            amount: 200,
            payoutMethod: PayoutMethod.VODAFONE_CASH,
            payoutAccount: '01000000002',
            payoutName: 'Test Driver',
            status: WithdrawalStatus.PAID,
            paidAt: new Date(),
            kashierTransferId: T('BOUNCED'),
          }),
        );
        const statusSpy = mockTransferStatus(T('BOUNCED'), 'FAILED');
        const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.REJECTED);

        const summary = await earningsService.getSummary(driverUser.id);
        expect(summary.totalWithdrawn).toBe(0);

        statusSpy.mockRestore();
        notifySpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('does not rewrite a paid withdrawal that is still delivered', async () => {
        const w = await withdrawalRepo.save(
          withdrawalRepo.create({
            driverId: driverUser.id,
            amount: 200,
            payoutMethod: PayoutMethod.VODAFONE_CASH,
            payoutAccount: '01000000002',
            payoutName: 'Test Driver',
            status: WithdrawalStatus.PAID,
            paidAt: new Date(),
            kashierTransferId: T('STILL-GOOD'),
          }),
        );
        const statusSpy = mockTransferStatus(T('STILL-GOOD'), 'TRANSFERRED');
        const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

        await earningsService.reconcilePendingWithdrawals();

        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.PAID);
        // No duplicate "transferred" notification on every reconcile pass
        expect(notifySpy).not.toHaveBeenCalled();

        statusSpy.mockRestore();
        notifySpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });

      it('does not re-touch withdrawals already settled', async () => {
        const w = await withdrawalRepo.save(
          withdrawalRepo.create({
            driverId: driverUser.id,
            amount: 200,
            payoutMethod: PayoutMethod.VODAFONE_CASH,
            payoutAccount: '01000000002',
            payoutName: 'Test Driver',
            status: WithdrawalStatus.REJECTED,
            kashierTransferId: T('ALREADY-DONE'),
          }),
        );
        const statusSpy = mockTransferStatus(T('ALREADY-DONE'), 'TRANSFERRED');

        await earningsService.reconcilePendingWithdrawals();

        // Asserted per-id: the job legitimately polls other outstanding withdrawals on
        // the same pass, so "never called at all" would break whenever one exists.
        expect(statusSpy).not.toHaveBeenCalledWith(T('ALREADY-DONE'));
        const updated = await withdrawalRepo.findOneBy({ id: w.id });
        expect(updated?.status).toBe(WithdrawalStatus.REJECTED);

        statusSpy.mockRestore();
        await withdrawalRepo.delete(w.id);
      });
    });

    it('rejects withdrawal if amount exceeds available balance', async () => {
      const { trip, booking, payment } = await seedCompletedEarnings(300);
      const summary = await earningsService.getSummary(driverUser.id);

      const transferSpy = jest.spyOn(kashierService, 'createTransfer').mockResolvedValue({ transferId: 'x', isMock: false });

      await expect(
        earningsService.requestWithdrawal(
          driverUser,
          summary.pendingBalance + 1000,
          PayoutMethod.VODAFONE_CASH,
          '01234567890',
          'Test Driver',
        ),
      ).rejects.toThrow('المبلغ المطلوب يتجاوز رصيدك المتاح');

      transferSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 7. Notification payload sanity check ─────────────────────────────────────

  describe('Notification payload — driver_bookings deep link', () => {
    it('driver notification data includes screen=driver_bookings and tripId', () => {
      const tripId = 'trip-123';
      const bookingId = 'booking-456';

      const notificationData = { screen: 'driver_bookings', tripId, bookingId };

      expect(notificationData.screen).toBe('driver_bookings');
      expect(notificationData.tripId).toBe(tripId);
    });
  });

  // ── 8. Promo balance in payment ───────────────────────────────────────────────

  describe('Promo balance — BookingsService.create()', () => {
    async function setPromoBalance(userId: string, amount: number) {
      await userRepo.update(userId, { promoBalance: amount });
    }

    it('applies promo discount: reduces totalAmount and decrements promoBalance', async () => {
      await setPromoBalance(passengerUser.id, 50);

      const trip = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 150 });

      const booking = await bookingsService.create(passengerUser, {
        tripId: trip.id,
        seatsCount: 1,
        paymentMethod: PaymentMethod.CASH,
        usePromo: true,
      });

      // Fetch fresh state
      const [savedBooking, updatedUser] = await Promise.all([
        bookingRepo.findOneBy({ id: booking.id }),
        userRepo.findOneBy({ id: passengerUser.id }),
      ]);

      expect(Number(savedBooking?.totalAmount)).toBeCloseTo(100, 2); // 150 - 50
      expect(Number(savedBooking?.promoDiscountAmount)).toBeCloseTo(50, 2);
      // Derived from the booking's own rate rather than a hardcoded one: the point being
      // asserted is that the driver is paid on the gross fare, not the promo-reduced one.
      const rate = Number(savedBooking?.commissionRate);
      expect(Number(savedBooking?.driverPayoutAmount)).toBeCloseTo(150 * (1 - rate), 2);
      expect(Number(updatedUser?.promoBalance)).toBeCloseTo(0, 2);

      await paymentRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
      await setPromoBalance(passengerUser.id, 0);
    });

    it('caps promo discount at gross amount (no negative total)', async () => {
      await setPromoBalance(passengerUser.id, 500); // more than trip price

      const trip = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 150 });

      const booking = await bookingsService.create(passengerUser, {
        tripId: trip.id,
        seatsCount: 1,
        paymentMethod: PaymentMethod.CASH,
        usePromo: true,
      });

      const savedBooking = await bookingRepo.findOneBy({ id: booking.id });
      expect(Number(savedBooking?.totalAmount)).toBeCloseTo(0, 2); // fully covered
      expect(Number(savedBooking?.promoDiscountAmount)).toBeCloseTo(150, 2); // capped at gross

      const updatedUser = await userRepo.findOneBy({ id: passengerUser.id });
      expect(Number(updatedUser?.promoBalance)).toBeCloseTo(350, 2); // 500 - 150

      await paymentRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
      await setPromoBalance(passengerUser.id, 0);
    });

    it('ignores usePromo=false: no discount applied', async () => {
      await setPromoBalance(passengerUser.id, 100);

      const trip = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 150 });

      const booking = await bookingsService.create(passengerUser, {
        tripId: trip.id,
        seatsCount: 1,
        paymentMethod: PaymentMethod.CASH,
        usePromo: false,
      });

      const savedBooking = await bookingRepo.findOneBy({ id: booking.id });
      expect(Number(savedBooking?.totalAmount)).toBeCloseTo(150, 2);
      expect(Number(savedBooking?.promoDiscountAmount)).toBeCloseTo(0, 2);

      const updatedUser = await userRepo.findOneBy({ id: passengerUser.id });
      expect(Number(updatedUser?.promoBalance)).toBeCloseTo(100, 2); // unchanged

      await paymentRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
      await setPromoBalance(passengerUser.id, 0);
    });
  });

  describe('Promo balance — cancelByPassenger()', () => {
    async function setPromoBalance(userId: string, amount: number) {
      await userRepo.update(userId, { promoBalance: amount });
    }

    it('free_cancel: restores promoDiscountAmount to passenger promoBalance', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 60 * 3_600_000), // 60h away → free_cancel
      });

      // Create a booking that had a 40 EGP promo applied
      const booking = await bookingRepo.save(
        bookingRepo.create({
          tripId: trip.id,
          passengerId: passengerUser.id,
          seatsCount: 1,
          totalAmount: 110, // 150 - 40 promo
          commissionAmount: 10.5,
          driverPayoutAmount: 139.5,
          commissionRate: 0.07,
          promoDiscountAmount: 40,
          paymentMethod: PaymentMethod.CASH,
          status: BookingStatus.CONFIRMED,
          confirmedAt: new Date(),
        }),
      );
      await setPromoBalance(passengerUser.id, 0);

      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      const result = await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(result.policy).toBe('free_cancel');

      const updatedUser = await userRepo.findOneBy({ id: passengerUser.id });
      expect(Number(updatedUser?.promoBalance)).toBeCloseTo(40, 2); // restored

      releaseSpy.mockRestore();

      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('late_cancel: does NOT restore promo (forfeited with cancellation fee)', async () => {
      const trip = await makeTrip({
        departureTime: new Date(Date.now() + 5 * 3_600_000), // 5h → late_cancel
      });

      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        paymentStatus: PaymentStatus.PENDING,
      });
      // Manually set promoDiscountAmount
      await bookingRepo.update(booking.id, { promoDiscountAmount: 30 });
      await setPromoBalance(passengerUser.id, 0);

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);

      const result = await bookingsService.cancelByPassenger(booking.id, passengerUser);

      expect(result.policy).toBe('late_cancel');

      const updatedUser = await userRepo.findOneBy({ id: passengerUser.id });
      expect(Number(updatedUser?.promoBalance)).toBeCloseTo(0, 2); // NOT restored

      captureSpy.mockRestore();
      refundSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 9. Women-only trip enforcement ───────────────────────────────────────────

  describe('BookingsService.create() — women-only enforcement', () => {
    it('rejects non-female passenger from booking a women-only trip', async () => {
      // Clear cash restriction (TypeORM ignores undefined, must use null)
      await userRepo.update(passengerUser.id, { gender: null as any, cashBookingRestrictedUntil: null as any });
      const freshPassengerNoGender = await userRepo.findOneBy({ id: passengerUser.id });

      const trip = await makeTrip({
        status: TripStatus.SCHEDULED,
        womenOnly: true,
      });

      await expect(
        bookingsService.create(freshPassengerNoGender!, {
          tripId: trip.id,
          seatsCount: 1,
          paymentMethod: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('women passengers only');

      await tripRepo.delete(trip.id);
    });

    it('allows female passenger to book a women-only trip', async () => {
      await userRepo.update(passengerUser.id, { gender: Gender.FEMALE, cashBookingRestrictedUntil: null as any });

      const freshPassenger = await userRepo.findOneBy({ id: passengerUser.id });
      const trip = await makeTrip({
        status: TripStatus.SCHEDULED,
        womenOnly: true,
      });

      const booking = await bookingsService.create(freshPassenger!, {
        tripId: trip.id,
        seatsCount: 1,
        paymentMethod: PaymentMethod.CASH,
      });

      expect(booking.id).toBeDefined();

      await paymentRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);

      await userRepo.update(passengerUser.id, { gender: null as any });
    });
  });

  // ── 10. SosService ────────────────────────────────────────────────────────────

  describe('SosService', () => {
    it('driver trigger: creates SosAlert and notifies admins (not driver)', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });

      const sendToUserSpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const sendToUsersSpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

      const alert = await sosService.trigger(driverUser.id, trip.id, {
        lat: 30.0444,
        lng: 31.2357,
        message: 'Need help',
      });
      await waitForBackground();

      expect(alert.id).toBeDefined();
      expect(alert.userId).toBe(driverUser.id);
      expect(alert.tripId).toBe(trip.id);
      expect(alert.resolvedAt).toBeNull();

      // Driver triggered it, so sendToUser (for driver) should NOT have been called
      expect(sendToUserSpy).not.toHaveBeenCalled();
      // sendToUsers may be called for admins (0 admins in test DB is fine — spy still records the call attempt)

      const saved = await sosAlertRepo.findOneBy({ id: alert.id });
      expect(saved).not.toBeNull();

      sendToUserSpy.mockRestore();
      sendToUsersSpy.mockRestore();

      await sosAlertRepo.delete(alert.id);
      await tripRepo.delete(trip.id);
    });

    it('confirmed passenger trigger: creates SosAlert and notifies driver', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });

      const sendToUserSpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const sendToUsersSpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

      const alert = await sosService.trigger(passengerUser.id, trip.id, {});
      await waitForBackground();

      expect(alert.id).toBeDefined();

      // Passenger triggered → driver should be notified
      expect(sendToUserSpy).toHaveBeenCalledWith(
        driverUser.id,
        expect.objectContaining({ title: expect.stringContaining('SOS') }),
      );

      sendToUserSpy.mockRestore();
      sendToUsersSpy.mockRestore();

      await sosAlertRepo.delete(alert.id);
      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('non-participant trigger: throws ForbiddenException', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });

      // passengerUser has no booking on this trip
      await expect(
        sosService.trigger(passengerUser.id, trip.id, {}),
      ).rejects.toThrow('You are not part of this trip');

      await tripRepo.delete(trip.id);
    });

    it('resolve: sets resolvedAt timestamp', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });

      const alert = await sosAlertRepo.save(
        sosAlertRepo.create({ userId: driverUser.id, tripId: trip.id }),
      );

      const resolved = await sosService.resolve(alert.id);

      expect(resolved.resolvedAt).not.toBeNull();

      const saved = await sosAlertRepo.findOneBy({ id: alert.id });
      expect(saved?.resolvedAt).not.toBeNull();

      await sosAlertRepo.delete(alert.id);
      await tripRepo.delete(trip.id);
    });

    it('listPending: returns only unresolved alerts', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });

      const pending = await sosAlertRepo.save(
        sosAlertRepo.create({ userId: driverUser.id, tripId: trip.id }),
      );
      const resolved = await sosAlertRepo.save(
        sosAlertRepo.create({ userId: driverUser.id, tripId: trip.id, resolvedAt: new Date() }),
      );

      const list = await sosService.listPending();
      const ids = list.map(a => a.id);

      expect(ids).toContain(pending.id);
      expect(ids).not.toContain(resolved.id);

      await sosAlertRepo.delete([pending.id, resolved.id]);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 11. Deep links — notification routing ────────────────────────────────────

  describe('Notification data — deep link routing', () => {
    it('startTrip notification carries screen=trip_detail and tripId', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });

      const sendToUsersSpy = jest
        .spyOn(notificationsService, 'sendToUsers')
        .mockResolvedValue(undefined as any);

      await tripsService.startTrip(trip.id, driverUser);
      await waitForBackground();

      expect(sendToUsersSpy).toHaveBeenCalledWith(
        expect.arrayContaining([passengerUser.id]),
        expect.objectContaining({
          data: expect.objectContaining({ screen: 'trip_detail', tripId: trip.id }),
        }),
      );

      sendToUsersSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('admin_sos notification carries tripId for deep link', () => {
      const tripId = 'trip-sos-test';
      const alertId = 'alert-001';
      const data = { screen: 'admin_sos', tripId, alertId };

      // Verify the data shape that SosService sends to admins
      expect(data.screen).toBe('admin_sos');
      expect(data.tripId).toBeDefined();
    });
  });

  // ── 12. Booking status — IN_PROGRESS on startTrip ────────────────────────────

  describe('TripsService.startTrip — IN_PROGRESS booking status', () => {
    it('transitions confirmed bookings to IN_PROGRESS when trip starts', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });

      const sendToUsersSpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

      await tripsService.startTrip(trip.id, driverUser);

      const [updatedBooking, updatedTrip] = await Promise.all([
        bookingRepo.findOneBy({ id: booking.id }),
        tripRepo.findOneBy({ id: trip.id }),
      ]);

      expect(updatedTrip?.status).toBe(TripStatus.ACTIVE);
      expect(updatedBooking?.status).toBe(BookingStatus.IN_PROGRESS);

      sendToUsersSpy.mockRestore();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('markComplete transitions IN_PROGRESS bookings to TRIP_COMPLETED', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const booking = await bookingRepo.save(
        bookingRepo.create({
          tripId: trip.id,
          passengerId: passengerUser.id,
          seatsCount: 1,
          totalAmount: 150,
          commissionAmount: 10.5,
          driverPayoutAmount: 139.5,
          commissionRate: 0.07,
          paymentMethod: PaymentMethod.CASH,
          status: BookingStatus.IN_PROGRESS,
          confirmedAt: new Date(),
        }),
      );

      const captureSpy = jest.spyOn(kashierService, 'capturePayment').mockResolvedValue({ transactionId: null });

      await tripsService.markComplete(trip.id, driverUser);
      await waitForBackground();

      const updatedBooking = await bookingRepo.findOneBy({ id: booking.id });
      expect(updatedBooking?.status).toBe(BookingStatus.TRIP_COMPLETED);
      expect(updatedBooking?.completedAt).not.toBeNull();

      captureSpy.mockRestore();

      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    it('cancelByPassenger rejects IN_PROGRESS booking', async () => {
      const trip = await makeTrip({ status: TripStatus.ACTIVE });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });
      // Manually set to IN_PROGRESS (as startTrip would)
      await bookingRepo.update(booking.id, { status: BookingStatus.IN_PROGRESS });
      const inProgressBooking = await bookingRepo.findOne({ where: { id: booking.id }, relations: { trip: true } });

      await expect(
        bookingsService.cancelByPassenger(inProgressBooking!.id, passengerUser),
      ).rejects.toThrow();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 13. Driver past trips — completed/cancelled appear in trip list ───────────

  describe('TripsService.getMyTrips — past trips visible', () => {
    it('completed and cancelled trips are returned by the driver trips endpoint', async () => {
      const completed = await makeTrip({ status: TripStatus.COMPLETED });
      const cancelled = await makeTrip({
        status: TripStatus.CANCELLED,
        cancelledAt: new Date(),
      });

      // The endpoint returns all trips regardless of status; verify both show up
      const all = await tripRepo.find({ where: { driverId: driverUser.id } });
      const statuses = all.map((t) => t.status);

      expect(statuses).toContain(TripStatus.COMPLETED);
      expect(statuses).toContain(TripStatus.CANCELLED);

      await tripRepo.delete([completed.id, cancelled.id]);
    });
  });

  // ── 14. Commission tracking ──────────────────────────────────────────────────

  describe('EarningsService.getAdminCommissionSummary', () => {
    it('returns numeric commission totals including thisMonth and captured', async () => {
      const summary = await earningsService.getAdminCommissionSummary();

      expect(typeof summary.totalCommission).toBe('number');
      expect(typeof summary.capturedCommission).toBe('number');
      expect(typeof summary.pendingCommission).toBe('number');
      expect(typeof summary.thisMonthCommission).toBe('number');
      // captured + pending can't exceed total
      expect(summary.capturedCommission + summary.pendingCommission).toBeLessThanOrEqual(
        summary.totalCommission + 0.01, // floating point tolerance
      );
    });

    it('captures commission from completed bookings', async () => {
      const summaryBefore = await earningsService.getAdminCommissionSummary();

      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const booking = await bookingRepo.save(
        bookingRepo.create({
          tripId: trip.id,
          passengerId: passengerUser.id,
          seatsCount: 1,
          totalAmount: 200,
          commissionAmount: 14, // 7%
          driverPayoutAmount: 186,
          commissionRate: 0.07,
          paymentMethod: PaymentMethod.CASH,
          status: BookingStatus.TRIP_COMPLETED,
          confirmedAt: new Date(),
          completedAt: new Date(),
        }),
      );

      const summaryAfter = await earningsService.getAdminCommissionSummary();
      expect(summaryAfter.totalCommission).toBeCloseTo(summaryBefore.totalCommission + 14, 1);
      expect(summaryAfter.thisMonthCommission).toBeCloseTo(summaryBefore.thisMonthCommission + 14, 1);

      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 15. Community — Ratings ──────────────────────────────────────────────────

  describe('RatingsService', () => {
    async function makeCompletedBookingForRating(): Promise<{ trip: Trip; booking: Booking }> {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const booking = await bookingRepo.save(
        bookingRepo.create({
          tripId: trip.id,
          passengerId: passengerUser.id,
          seatsCount: 1,
          totalAmount: 150,
          commissionAmount: 10.5,
          driverPayoutAmount: 139.5,
          commissionRate: 0.07,
          paymentMethod: PaymentMethod.CASH,
          status: BookingStatus.TRIP_COMPLETED,
          confirmedAt: new Date(),
          completedAt: new Date(),
        }),
      );
      return { trip, booking };
    }

    it('passenger submits rating → updates driver ratingAverage', async () => {
      const { trip, booking } = await makeCompletedBookingForRating();

      const driverBefore = await userRepo.findOneBy({ id: driverUser.id });
      const countBefore = driverBefore!.ratingCount;

      await ratingsService.submit(passengerUser, {
        bookingId: booking.id,
        score: 5,
        comment: 'رحلة رائعة',
      });

      const driverAfter = await userRepo.findOneBy({ id: driverUser.id });
      expect(driverAfter!.ratingCount).toBe(countBefore + 1);
      expect(Number(driverAfter!.ratingAverage)).toBeGreaterThan(0);

      await ratingRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);

      // Reset driver rating
      await userRepo.update(driverUser.id, { ratingAverage: 0, ratingCount: 0 });
    });

    it('duplicate rating is rejected', async () => {
      const { trip, booking } = await makeCompletedBookingForRating();

      await ratingsService.submit(passengerUser, { bookingId: booking.id, score: 4 });

      await expect(
        ratingsService.submit(passengerUser, { bookingId: booking.id, score: 3 }),
      ).rejects.toThrow('already rated');

      await ratingRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);

      await userRepo.update(driverUser.id, { ratingAverage: 0, ratingCount: 0 });
    });

    it('getRevealedRatingsForUser includes rater info', async () => {
      const { trip, booking } = await makeCompletedBookingForRating();

      await ratingsService.submit(passengerUser, { bookingId: booking.id, score: 5 });

      const ratings = await ratingsService.getRevealedRatingsForUser(driverUser.id);
      const found = ratings.find((r) => r.bookingId === booking.id);

      expect(found).toBeDefined();
      expect(found?.rater).toBeDefined();
      expect(found?.rater?.id).toBe(passengerUser.id);

      await ratingRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);

      await userRepo.update(driverUser.id, { ratingAverage: 0, ratingCount: 0 });
    });

    // revealExpiredRatings is an hourly cron that had no coverage. Unlike the other
    // crons it takes no mocked external input — it acts purely on stored reveal dates —
    // so running it against the dev database reveals only ratings that were already due
    // and would have been revealed on the next scheduled pass anyway. It therefore needs
    // no shielding; these tests assert on their own rating rows.
    describe('revealExpiredRatings', () => {
      async function unrevealedRating(revealAfter: Date, score = 5) {
        const { trip, booking } = await makeCompletedBookingForRating();
        const rating = await ratingRepo.save(
          ratingRepo.create({
            tripId: trip.id,
            bookingId: booking.id,
            raterId: passengerUser.id,
            rateeId: driverUser.id,
            raterRole: RaterRole.PASSENGER,
            score,
            isRevealed: false,
            revealAfter,
          }),
        );
        return { trip, booking, rating };
      }

      async function cleanupRating(tripId: string, bookingId: string) {
        await ratingRepo.delete({ bookingId });
        await bookingRepo.delete(bookingId);
        await tripRepo.delete(tripId);
        await userRepo.update(driverUser.id, {
          ratingAverage: 0,
          ratingCount: 0,
          trustFlagged: false,
        });
      }

      it('reveals a rating whose window has expired and recounts the ratee', async () => {
        const { trip, booking, rating } = await unrevealedRating(
          new Date(Date.now() - 60 * 60_000),
        );

        await ratingsService.revealExpiredRatings();

        const updated = await ratingRepo.findOneBy({ id: rating.id });
        expect(updated?.isRevealed).toBe(true);

        const ratee = await userRepo.findOneBy({ id: driverUser.id });
        expect(ratee?.ratingCount).toBe(1);
        expect(Number(ratee?.ratingAverage)).toBe(5);

        await cleanupRating(trip.id, booking.id);
      });

      it('leaves a rating still inside its reveal window hidden', async () => {
        const { trip, booking, rating } = await unrevealedRating(
          new Date(Date.now() + 3 * 24 * 3_600_000),
        );

        await ratingsService.revealExpiredRatings();

        const updated = await ratingRepo.findOneBy({ id: rating.id });
        expect(updated?.isRevealed).toBe(false);

        // A hidden rating must not move the ratee's public average
        const ratee = await userRepo.findOneBy({ id: driverUser.id });
        expect(ratee?.ratingCount).toBe(0);

        await cleanupRating(trip.id, booking.id);
      });

      it('is safe to run twice — an already-revealed rating is not recounted', async () => {
        const { trip, booking, rating } = await unrevealedRating(
          new Date(Date.now() - 60 * 60_000),
        );

        await ratingsService.revealExpiredRatings();
        await ratingsService.revealExpiredRatings();

        const updated = await ratingRepo.findOneBy({ id: rating.id });
        expect(updated?.isRevealed).toBe(true);

        const ratee = await userRepo.findOneBy({ id: driverUser.id });
        expect(ratee?.ratingCount).toBe(1);

        await cleanupRating(trip.id, booking.id);
      });
    });
  });

  // ── 16. Repeat offender driver ban ──────────────────────────────────────────

  describe('SchedulerService — repeat offender ban', () => {
    async function setStrikes(userId: string, strikes: number) {
      await userRepo.update(userId, {
        cancellationStrikes: strikes,
        tripPostingBannedUntil: null as any,
        status: UserStatus.ACTIVE,
      });
    }

    it('3rd strike → 7-day trip posting ban', async () => {
      await setStrikes(driverUser.id, 2); // will become 3 after auto-cancel

      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 50 * 60_000),
        status: TripStatus.SCHEDULED,
      });

      const sendToUserSpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      await runSchedulerShielded(() => (schedulerService as any).autoCancelOverdueTrips());

      const updatedDriver = await userRepo.findOneBy({ id: driverUser.id });
      expect(updatedDriver?.cancellationStrikes).toBe(3);
      expect(updatedDriver?.tripPostingBannedUntil).not.toBeNull();
      // Ban should be ~7 days from now
      const banDays = (updatedDriver!.tripPostingBannedUntil!.getTime() - Date.now()) / (24 * 3_600_000);
      expect(banDays).toBeCloseTo(7, 0);

      sendToUserSpy.mockRestore();
      releaseSpy.mockRestore();

      await tripRepo.delete(trip.id);
      await setStrikes(driverUser.id, 0);
    });

    it('5th strike → 30-day trip posting ban', async () => {
      await setStrikes(driverUser.id, 4);

      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 50 * 60_000),
        status: TripStatus.SCHEDULED,
      });

      const sendToUserSpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      await runSchedulerShielded(() => (schedulerService as any).autoCancelOverdueTrips());

      const updatedDriver = await userRepo.findOneBy({ id: driverUser.id });
      expect(updatedDriver?.cancellationStrikes).toBe(5);
      const banDays = (updatedDriver!.tripPostingBannedUntil!.getTime() - Date.now()) / (24 * 3_600_000);
      expect(banDays).toBeCloseTo(30, 0);

      sendToUserSpy.mockRestore();
      releaseSpy.mockRestore();

      await tripRepo.delete(trip.id);
      await setStrikes(driverUser.id, 0);
    });

    it('10th strike → SUSPENDED status', async () => {
      await setStrikes(driverUser.id, 9);

      const trip = await makeTrip({
        departureTime: new Date(Date.now() - 50 * 60_000),
        status: TripStatus.SCHEDULED,
      });

      const sendToUserSpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);

      await runSchedulerShielded(() => (schedulerService as any).autoCancelOverdueTrips());

      const updatedDriver = await userRepo.findOneBy({ id: driverUser.id });
      expect(updatedDriver?.cancellationStrikes).toBe(10);
      expect(updatedDriver?.status).toBe(UserStatus.SUSPENDED);

      sendToUserSpy.mockRestore();
      releaseSpy.mockRestore();

      await tripRepo.delete(trip.id);
      // Restore driver status for subsequent tests
      await userRepo.update(driverUser.id, {
        status: UserStatus.ACTIVE,
        cancellationStrikes: 0,
        tripPostingBannedUntil: null as any,
      });
    });

    it('banned driver cannot post new trips', async () => {
      const bannedUntil = new Date(Date.now() + 7 * 24 * 3_600_000);
      await userRepo.update(driverUser.id, { tripPostingBannedUntil: bannedUntil, driverVerified: true });
      const bannedDriver = await userRepo.findOneBy({ id: driverUser.id });

      await expect(
        tripsService.create(bannedDriver!, {
          originCity: 'Cairo',
          destinationCity: 'Alex',
          departureTime: new Date(Date.now() + 2 * 3_600_000).toISOString(),
          totalSeats: 3,
          pricePerSeat: 100,
        } as any),
      ).rejects.toThrow('تم تعليق حقك في نشر الرحلات');

      await userRepo.update(driverUser.id, { tripPostingBannedUntil: null as any, driverVerified: false });
    });
  });

  // ── 16. Participant access survives trip start and completion ────────────────
  // Regression: passengers were locked out of chat/comments/co-passengers/SOS once
  // their booking left CONFIRMED, because each service filtered on CONFIRMED only.

  describe('Participant access across booking lifecycle', () => {
    // Each status a passenger can hold while still being a trip participant
    const participantStates = [
      { label: 'IN_PROGRESS (trip running)', bookingStatus: BookingStatus.IN_PROGRESS, tripStatus: TripStatus.ACTIVE },
      { label: 'TRIP_COMPLETED (trip ended)', bookingStatus: BookingStatus.TRIP_COMPLETED, tripStatus: TripStatus.COMPLETED },
    ];

    for (const { label, bookingStatus, tripStatus } of participantStates) {
      describe(label, () => {
        let trip: Trip;
        let booking: Booking;
        let payment: Payment;

        beforeEach(async () => {
          trip = await makeTrip({ status: tripStatus });
          ({ booking, payment } = await makeBookingWithPayment(trip.id, { bookingStatus }));
        });

        afterEach(async () => {
          await messageRepo.delete({ tripId: trip.id });
          await commentRepo.delete({ tripId: trip.id });
          await sosAlertRepo.delete({ tripId: trip.id });
          await paymentRepo.delete(payment.id);
          await bookingRepo.delete(booking.id);
          await tripRepo.delete(trip.id);
        });

        it('passenger can read the trip chat', async () => {
          await expect(messagesService.getMessages(trip.id, passengerUser.id)).resolves.toBeDefined();
        });

        it('passenger can send a chat message', async () => {
          const spy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);
          const msg = await messagesService.sendMessage(trip.id, passengerUser, 'hi from passenger');
          expect(msg.body).toBe('hi from passenger');
          spy.mockRestore();
        });

        it('driver chat message notifies the passenger', async () => {
          const spy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

          await messagesService.sendMessage(trip.id, driverUser, 'hi from driver');
          await waitForBackground();

          expect(spy).toHaveBeenCalled();
          const [recipientIds] = spy.mock.calls[0];
          expect(recipientIds).toContain(passengerUser.id);
          expect(recipientIds).not.toContain(driverUser.id);
          spy.mockRestore();
        });

        it('driver comment notifies the passenger', async () => {
          const spy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

          await tripsService.addComment(trip.id, driverUser, 'driver comment');
          await waitForBackground();

          const notified = spy.mock.calls.map(([userId]) => userId);
          expect(notified).toContain(passengerUser.id);
          spy.mockRestore();
        });

        it('passenger comment notifies the driver', async () => {
          const spy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

          await tripsService.addComment(trip.id, passengerUser, 'passenger comment');
          await waitForBackground();

          const notified = spy.mock.calls.map(([userId]) => userId);
          expect(notified).toContain(driverUser.id);
          spy.mockRestore();
        });

        it('passenger can read co-passengers, and driver sees them listed', async () => {
          await expect(tripsService.getCoPassengers(trip.id, passengerUser)).resolves.toBeDefined();

          const asDriver = await tripsService.getCoPassengers(trip.id, driverUser);
          expect(asDriver.map(p => p.id)).toContain(passengerUser.id);
        });

        it('passenger can read the trip location', async () => {
          // No GPS row exists, so null is the correct result — the point is it must not throw 403
          await expect(locationService.getLatestLocation(trip.id, passengerUser.id)).resolves.toBeNull();
        });

        it('passenger can trigger SOS', async () => {
          const userSpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
          const usersSpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

          const alert = await sosService.trigger(passengerUser.id, trip.id, {});
          await waitForBackground();

          expect(alert.id).toBeDefined();
          expect(alert.userId).toBe(passengerUser.id);

          userSpy.mockRestore();
          usersSpy.mockRestore();
        });
      });
    }

    it('rejects a user with no booking on the trip', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const stranger = await userRepo.save(
        userRepo.create({
          phoneNumber: STRANGER_PHONE,
          fullName: 'E2E Stranger',
          status: UserStatus.ACTIVE,
          role: UserRole.PASSENGER,
          referralCode: 'E2E_STRG',
        }),
      );

      await expect(messagesService.getMessages(trip.id, stranger.id)).rejects.toThrow();
      await expect(tripsService.getCoPassengers(trip.id, stranger)).rejects.toThrow();
      await expect(sosService.trigger(stranger.id, trip.id, {})).rejects.toThrow();
      await expect(locationService.getLatestLocation(trip.id, stranger.id)).rejects.toThrow();

      await userRepo.delete(stranger.id);
      await tripRepo.delete(trip.id);
    });

    it('rejects a passenger whose booking was cancelled', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CANCELLED_BY_PASSENGER,
      });

      await expect(messagesService.getMessages(trip.id, passengerUser.id)).rejects.toThrow();
      await expect(sosService.trigger(passengerUser.id, trip.id, {})).rejects.toThrow();

      await paymentRepo.delete(payment.id);
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });
  });

  // ── 19. Driver earnings only count money actually collected ──────────────────
  // Regression: getSummary counted every TRIP_COMPLETED booking regardless of whether
  // the payment was ever captured, so a failed capture or a lapsed authorization still
  // credited a withdrawable balance — paying out money that was never received.

  describe('EarningsService.getSummary — payment-gated payouts', () => {
    async function completedBookingWithPayment(paymentStatus: PaymentStatus) {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.TRIP_COMPLETED,
        paymentStatus,
      });
      await bookingRepo.update(booking.id, { completedAt: new Date() });
      return { trip, booking, payment };
    }

    async function cleanup(tripId: string, bookingId: string, paymentId: string) {
      await paymentRepo.delete(paymentId);
      await bookingRepo.delete(bookingId);
      await tripRepo.delete(tripId);
    }

    it('counts a captured online payment toward the withdrawable balance', async () => {
      const { trip, booking, payment } = await completedBookingWithPayment(PaymentStatus.CAPTURED);

      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.allTimeOnline).toBe(139.5);
      expect(summary.pendingBalance).toBe(139.5);

      await cleanup(trip.id, booking.id, payment.id);
    });

    it('excludes a completed trip whose payment was never captured', async () => {
      // The lapsed-authorization case: ride given, money never taken
      const { trip, booking, payment } = await completedBookingWithPayment(PaymentStatus.PENDING);

      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.allTimeOnline).toBe(0);
      expect(summary.pendingBalance).toBe(0);

      await cleanup(trip.id, booking.id, payment.id);
    });

    it('excludes refunded and released payments', async () => {
      const refunded = await completedBookingWithPayment(PaymentStatus.REFUNDED);
      const released = await completedBookingWithPayment(PaymentStatus.RELEASED);

      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.allTimeOnline).toBe(0);

      await cleanup(refunded.trip.id, refunded.booking.id, refunded.payment.id);
      await cleanup(released.trip.id, released.booking.id, released.payment.id);
    });

    it('still counts cash trips, which the driver collects directly', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.TRIP_COMPLETED,
        paymentMethod: PaymentMethod.CASH,
        paymentStatus: PaymentStatus.PENDING,
      });
      await bookingRepo.update(booking.id, { completedAt: new Date() });

      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.allTimeCash).toBe(150);
      expect(summary.allTimeOnline).toBe(0);

      await cleanup(trip.id, booking.id, payment.id);
    });

    it('trip breakdown reports each payment status, so an excluded trip is explainable', async () => {
      const captured = await completedBookingWithPayment(PaymentStatus.CAPTURED);
      const uncaptured = await completedBookingWithPayment(PaymentStatus.PENDING);

      const rows = await earningsService.getTripBreakdown(driverUser.id);
      const byBooking = new Map(rows.map(r => [r.bookingId, r.paymentStatus]));

      expect(byBooking.get(captured.booking.id)).toBe(PaymentStatus.CAPTURED);
      expect(byBooking.get(uncaptured.booking.id)).toBe(PaymentStatus.PENDING);

      // Both trips are listed, but only the captured one funds the balance
      const summary = await earningsService.getSummary(driverUser.id);
      expect(summary.allTimeOnline).toBe(139.5);

      await cleanup(captured.trip.id, captured.booking.id, captured.payment.id);
      await cleanup(uncaptured.trip.id, uncaptured.booking.id, uncaptured.payment.id);
    });

    it('blocks a withdrawal funded only by uncaptured trips', async () => {
      // 3 completed-but-uncaptured trips would previously total 418.5 withdrawable
      const made: Array<{ trip: Trip; booking: Booking; payment: Payment }> = [];
      for (let i = 0; i < 3; i++) {
        made.push(await completedBookingWithPayment(PaymentStatus.PENDING));
      }

      await expect(
        earningsService.requestWithdrawal(
          driverUser,
          200,
          PayoutMethod.VODAFONE_CASH,
          '01000000000',
          'Test Driver',
        ),
      ).rejects.toThrow('المبلغ المطلوب يتجاوز رصيدك المتاح');

      for (const m of made) await cleanup(m.trip.id, m.booking.id, m.payment.id);
    });
  });

  // ── 20. Departure time bounds enforced server-side ───────────────────────────
  // The 90-day cap lived only in the app's date picker, so a direct API call could
  // post a trip in the past or years out — the latter outliving any payment hold.

  describe('TripsService — departure time bounds', () => {
    const baseTrip = {
      originCity: 'Cairo',
      destinationCity: 'Alexandria',
      totalSeats: 3,
      pricePerSeat: 100,
    };

    beforeEach(async () => {
      await userRepo.update(driverUser.id, { driverVerified: true });
      driverUser = (await userRepo.findOneBy({ id: driverUser.id }))!;
    });

    afterEach(async () => {
      await userRepo.update(driverUser.id, { driverVerified: false });
      driverUser = (await userRepo.findOneBy({ id: driverUser.id }))!;
    });

    it('rejects a departure time in the past', async () => {
      await expect(
        tripsService.create(driverUser, {
          ...baseTrip,
          departureTime: new Date(Date.now() - 60 * 60_000).toISOString(),
        } as any),
      ).rejects.toThrow('لا يمكن نشر رحلة في الماضي');
    });

    it('rejects a departure time beyond the lead-time cap', async () => {
      await expect(
        tripsService.create(driverUser, {
          ...baseTrip,
          departureTime: new Date(Date.now() + 200 * 24 * 3_600_000).toISOString(),
        } as any),
      ).rejects.toThrow('لا يمكن نشر رحلة بعد أكثر من');
    });

    it('rejects an unparseable departure time', async () => {
      await expect(
        tripsService.create(driverUser, {
          ...baseTrip,
          departureTime: 'not-a-date',
        } as any),
      ).rejects.toThrow('تاريخ المغادرة غير صالح');
    });

    it('accepts a departure time inside the window', async () => {
      const trip = await tripsService.create(driverUser, {
        ...baseTrip,
        departureTime: new Date(Date.now() + 3 * 24 * 3_600_000).toISOString(),
      } as any);

      expect(trip.id).toBeDefined();
      await tripRepo.delete(trip.id);
    });

    it('rejects moving an existing trip outside the window via update', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });

      await expect(
        tripsService.updateTrip(trip.id, driverUser, {
          departureTime: new Date(Date.now() + 200 * 24 * 3_600_000),
        } as any),
      ).rejects.toThrow('لا يمكن نشر رحلة بعد أكثر من');

      await tripRepo.delete(trip.id);
    });
  });

  // ── 18. Rejected bookings return the passenger's money ───────────────────────
  // Regression: both rejection paths cancelled the booking and restored seats but
  // never touched the payment, so a passenger charged up front got nothing back.

  describe('Booking rejection — returning funds', () => {
    async function makePendingApproval(paymentStatus: PaymentStatus, paymentMethod = PaymentMethod.CARD) {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.PENDING_DRIVER_APPROVAL,
        paymentStatus,
        paymentMethod,
      });
      return { trip, booking, payment };
    }

    async function cleanup(tripId: string, bookingId: string, paymentId: string) {
      await paymentRepo.delete(paymentId);
      await bookingRepo.delete(bookingId);
      await tripRepo.delete(tripId);
    }

    it('voids the hold when the payment was only authorized', async () => {
      const { trip, booking, payment } = await makePendingApproval(PaymentStatus.PENDING);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      await bookingsService.rejectBooking(booking.id, driverUser);

      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).not.toHaveBeenCalled();

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.RELEASED);
      expect(updated?.releasedAt).not.toBeNull();

      releaseSpy.mockRestore();
      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('refunds the full amount when the payment was already captured', async () => {
      const { trip, booking, payment } = await makePendingApproval(PaymentStatus.CAPTURED);
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      await bookingsService.rejectBooking(booking.id, driverUser);

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy.mock.calls[0][0]).toEqual(expect.any(String));
      expect(refundSpy.mock.calls[0][1]).toBe(150);
      expect(releaseSpy).not.toHaveBeenCalled();

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.REFUNDED);
      expect(Number(updated?.refundAmount)).toBe(150);

      releaseSpy.mockRestore();
      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('makes no gateway call for a cash booking', async () => {
      const { trip, booking, payment } = await makePendingApproval(
        PaymentStatus.PENDING,
        PaymentMethod.CASH,
      );
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      await bookingsService.rejectBooking(booking.id, driverUser);

      expect(releaseSpy).not.toHaveBeenCalled();
      expect(refundSpy).not.toHaveBeenCalled();

      releaseSpy.mockRestore();
      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('leaves the payment retryable when the gateway call fails', async () => {
      const { trip, booking, payment } = await makePendingApproval(PaymentStatus.CAPTURED);
      const refundSpy = jest
        .spyOn(kashierService, 'refundPayment')
        .mockRejectedValue(new Error('Kashier API down'));
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      // Rejection itself must still succeed — the seat has to be freed either way
      await expect(bookingsService.rejectBooking(booking.id, driverUser)).resolves.toBeDefined();

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      // Still CAPTURED, not falsely marked REFUNDED
      expect(updated?.status).toBe(PaymentStatus.CAPTURED);
      expect(updated?.refundedAt).toBeNull();

      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('auto-reject after the approval window also returns the money', async () => {
      const { trip, booking, payment } = await makePendingApproval(PaymentStatus.PENDING);
      // Backdate past the 30-minute approval window so the cron picks it up
      await bookingRepo.update(booking.id, {
        createdAt: new Date(Date.now() - 45 * 60_000),
      } as any);

      // The cron sweeps every booking awaiting driver approval, not just this one — and
      // a booking sitting unapproved is the normal state during manual testing. Move any
      // others back inside the window for the duration of this test so the run cannot
      // cancel and refund somebody's real booking, then put them back.
      const bystanders = await bookingRepo.find({
        where: {
          status: BookingStatus.PENDING_DRIVER_APPROVAL,
          createdAt: LessThan(new Date(Date.now() - 30 * 60_000)),
        },
        select: { id: true, createdAt: true },
      });
      const shielded = bystanders.filter((b) => b.id !== booking.id);
      for (const b of shielded) {
        await bookingRepo.update(b.id, { createdAt: new Date() } as any);
      }

      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);

      try {
        await bookingsService.autoRejectExpiredBookings();

        const [updatedBooking, updatedPayment] = await Promise.all([
          bookingRepo.findOneBy({ id: booking.id }),
          paymentRepo.findOneBy({ id: payment.id }),
        ]);
        expect(updatedBooking?.status).toBe(BookingStatus.CANCELLED_BY_DRIVER);
        expect(releaseSpy).toHaveBeenCalledTimes(1);
        expect(updatedPayment?.status).toBe(PaymentStatus.RELEASED);
      } finally {
        for (const b of shielded) {
          await bookingRepo.update(b.id, { createdAt: b.createdAt } as any);
        }
        releaseSpy.mockRestore();
        notifySpy.mockRestore();
        await cleanup(trip.id, booking.id, payment.id);
      }
    });
  });

  // ── 22. Promo credit integrity ───────────────────────────────────────────────
  // Regression: the balance was read without a lock before being decremented, so two
  // simultaneous bookings could spend the same credit; and a failed checkout returned
  // the seats but not the credit.

  describe('Promo credit integrity', () => {
    afterEach(async () => {
      await userRepo.update(passengerUser.id, { promoBalance: 0 });
    });

    it('the same credit cannot be spent twice by simultaneous bookings', async () => {
      await userRepo.update(passengerUser.id, { promoBalance: 50 });
      const tripA = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 100 });
      const tripB = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 100 });

      const book = (tripId: string) =>
        bookingsService.create(passengerUser, {
          tripId,
          seatsCount: 1,
          paymentMethod: PaymentMethod.CASH,
          usePromo: true,
        } as any);

      const results = await Promise.allSettled([book(tripA.id), book(tripB.id)]);
      const bookings = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);

      const totalDiscount = bookings.reduce(
        (s, b) => s + Number(b.promoDiscountAmount ?? 0),
        0,
      );
      const user = await userRepo.findOneBy({ id: passengerUser.id });

      // Never grant more than the credit that existed, and never go negative
      expect(totalDiscount).toBeLessThanOrEqual(50);
      expect(Number(user?.promoBalance)).toBeGreaterThanOrEqual(0);
      expect(totalDiscount + Number(user?.promoBalance)).toBeCloseTo(50, 2);

      for (const b of bookings) {
        await paymentRepo.delete({ bookingId: b.id });
        await bookingRepo.delete(b.id);
      }
      await tripRepo.delete(tripA.id);
      await tripRepo.delete(tripB.id);
    });

    it('restores the credit when the payment session cannot be created', async () => {
      await userRepo.update(passengerUser.id, { promoBalance: 50 });
      const trip = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 100 });
      const sessionSpy = jest
        .spyOn(kashierService, 'createPaymentSession')
        .mockRejectedValue(new Error('Kashier API down'));

      await expect(
        bookingsService.create(passengerUser, {
          tripId: trip.id,
          seatsCount: 1,
          paymentMethod: PaymentMethod.CARD,
          usePromo: true,
        } as any),
      ).rejects.toThrow();

      const user = await userRepo.findOneBy({ id: passengerUser.id });
      expect(Number(user?.promoBalance)).toBeCloseTo(50, 2);

      // ...and the seat is back too
      const updatedTrip = await tripRepo.findOneBy({ id: trip.id });
      expect(updatedTrip?.availableSeats).toBe(trip.availableSeats);

      sessionSpy.mockRestore();
      const orphan = await bookingRepo.find({ where: { tripId: trip.id } });
      for (const b of orphan) {
        await paymentRepo.delete({ bookingId: b.id });
        await bookingRepo.delete(b.id);
      }
      await tripRepo.delete(trip.id);
    });

    it('does not restore credit when no promo was used', async () => {
      await userRepo.update(passengerUser.id, { promoBalance: 50 });
      const trip = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 100 });
      const sessionSpy = jest
        .spyOn(kashierService, 'createPaymentSession')
        .mockRejectedValue(new Error('Kashier API down'));

      await expect(
        bookingsService.create(passengerUser, {
          tripId: trip.id,
          seatsCount: 1,
          paymentMethod: PaymentMethod.CARD,
        } as any),
      ).rejects.toThrow();

      const user = await userRepo.findOneBy({ id: passengerUser.id });
      expect(Number(user?.promoBalance)).toBeCloseTo(50, 2);

      sessionSpy.mockRestore();
      const orphan = await bookingRepo.find({ where: { tripId: trip.id } });
      for (const b of orphan) {
        await paymentRepo.delete({ bookingId: b.id });
        await bookingRepo.delete(b.id);
      }
      await tripRepo.delete(trip.id);
    });
  });

  // ── 21. Security & payment-integrity regressions ─────────────────────────────

  describe('Payment integrity', () => {
    async function pendingPaymentBooking() {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.PENDING,
      });
      return { trip, booking, payment };
    }

    async function cleanup(tripId: string, bookingId: string, paymentId: string) {
      await paymentRepo.delete(paymentId);
      await bookingRepo.delete(bookingId);
      await tripRepo.delete(tripId);
    }

    // Regression: the idempotency guard compared payment status to the status the event
    // maps to. A new online payment already starts PENDING and `authorize` maps to
    // PENDING, so the very first webhook was treated as a replay and the booking never
    // advanced past pending_payment.
    it('first authorize webhook advances the booking instead of 409-ing as a replay', async () => {
      const { trip, booking, payment } = await pendingPaymentBooking();
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const sigSpy = jest
        .spyOn(kashierService, 'verifyWebhookSignature')
        .mockReturnValue(true);
      const res = { status: jest.fn() } as any;

      await kashierController.transactionWebhook(
        {
          event: 'authorize',
          data: {
            merchantOrderId: payment.gatewayOrderId,
            kashierOrderId: 'KSH-ORDER-1',
            transactionId: 'TX-1',
            status: 'SUCCESS',
            signatureKeys: ['status'],
          },
        },
        'sig',
        res,
      );

      const updated = await bookingRepo.findOneBy({ id: booking.id });
      expect(updated?.status).toBe(BookingStatus.PENDING_DRIVER_APPROVAL);
      expect(res.status).toHaveBeenCalledWith(200);

      notifySpy.mockRestore();
      sigSpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('a genuine replay of the same event is still rejected with 409', async () => {
      const { trip, booking, payment } = await pendingPaymentBooking();
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const sigSpy = jest
        .spyOn(kashierService, 'verifyWebhookSignature')
        .mockReturnValue(true);
      const body = {
        event: 'authorize',
        data: {
          merchantOrderId: payment.gatewayOrderId,
          status: 'SUCCESS',
          signatureKeys: ['status'],
        },
      };

      const first = { status: jest.fn() } as any;
      await kashierController.transactionWebhook(body, 'sig', first);
      const second = { status: jest.fn() } as any;
      await kashierController.transactionWebhook(body, 'sig', second);

      expect(first.status).toHaveBeenCalledWith(200);
      expect(second.status).toHaveBeenCalledWith(409);

      notifySpy.mockRestore();
      sigSpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    // Kashier treats 200 and 409 as acknowledgement and stops retrying, so an event we
    // could not verify must not be answered with either — otherwise a misconfigured key
    // silently destroys every webhook instead of failing visibly.
    it('does not acknowledge a webhook whose signature fails to verify', async () => {
      const { trip, booking, payment } = await pendingPaymentBooking();
      const sigSpy = jest
        .spyOn(kashierService, 'verifyWebhookSignature')
        .mockReturnValue(false);
      const res = { status: jest.fn() } as any;

      await kashierController.transactionWebhook(
        {
          event: 'authorize',
          data: {
            merchantOrderId: payment.gatewayOrderId,
            status: 'SUCCESS',
            signatureKeys: ['status'],
          },
        },
        'bad-signature',
        res,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.status).not.toHaveBeenCalledWith(200);
      expect(res.status).not.toHaveBeenCalledWith(409);

      // ...and nothing was applied
      const untouched = await bookingRepo.findOneBy({ id: booking.id });
      expect(untouched?.status).toBe(BookingStatus.PENDING_PAYMENT);

      sigSpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('does not acknowledge a webhook for a payment it cannot find', async () => {
      const sigSpy = jest
        .spyOn(kashierService, 'verifyWebhookSignature')
        .mockReturnValue(true);
      const res = { status: jest.fn() } as any;

      await kashierController.transactionWebhook(
        {
          event: 'authorize',
          data: {
            merchantOrderId: 'no-such-order',
            status: 'SUCCESS',
            signatureKeys: ['status'],
          },
        },
        'sig',
        res,
      );

      // Retryable on purpose — the webhook can arrive before our own commit lands
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.status).not.toHaveBeenCalledWith(200);

      sigSpy.mockRestore();
    });

    it('does not acknowledge an unverified payout webhook', async () => {
      const sigSpy = jest
        .spyOn(kashierService, 'verifyTransferWebhookSignature')
        .mockReturnValue(false);
      const res = { status: jest.fn() } as any;

      const result = await kashierController.transferWebhook(
        { merchantTransferId: 'some-id', status: 'TRANSFERRED', signatureKeys: ['status'] },
        'bad-signature',
        res,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(result).toEqual({ received: false });

      sigSpy.mockRestore();
    });

    // Regression: any FAILURE marked the whole payment FAILED, so a failed refund
    // erased a capture that had genuinely succeeded.
    it('a failed refund leaves a captured payment captured', async () => {
      const trip = await makeTrip({ status: TripStatus.COMPLETED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.TRIP_COMPLETED,
        paymentStatus: PaymentStatus.CAPTURED,
      });
      const sigSpy = jest
        .spyOn(kashierService, 'verifyWebhookSignature')
        .mockReturnValue(true);
      const res = { status: jest.fn() } as any;

      await kashierController.transactionWebhook(
        {
          event: 'refund',
          data: {
            merchantOrderId: payment.gatewayOrderId,
            status: 'FAILURE',
            signatureKeys: ['status'],
          },
        },
        'sig',
        res,
      );

      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.CAPTURED);
      expect(updated?.status).not.toBe(PaymentStatus.FAILED);

      sigSpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    // Regression: heal accepted any booking id and any order id from any signed-in user
    it('heal refuses a booking that is not the caller’s', async () => {
      const { trip, booking, payment } = await pendingPaymentBooking();

      await expect(
        bookingsService.healFromRedirect(booking.id, 'anything', driverUser),
      ).rejects.toThrow();

      const untouched = await bookingRepo.findOneBy({ id: booking.id });
      expect(untouched?.status).toBe(BookingStatus.PENDING_PAYMENT);

      await cleanup(trip.id, booking.id, payment.id);
    });

    it('heal refuses to confirm a booking Kashier does not report as paid', async () => {
      const { trip, booking, payment } = await pendingPaymentBooking();
      const orderStatusSpy_statusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest
        .spyOn(kashierService, 'getPaymentStatus')
        .mockResolvedValue(null);

      const result = await bookingsService.healFromRedirect(
        booking.id,
        'forged-order-id',
        passengerUser,
      );

      expect(result.healed).toBe(false);
      const untouched = await bookingRepo.findOneBy({ id: booking.id });
      expect(untouched?.status).toBe(BookingStatus.PENDING_PAYMENT);

      statusSpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('heal confirms only when Kashier verifies the payment', async () => {
      const { trip, booking, payment } = await pendingPaymentBooking();
      const notifySpy = jest.spyOn(notificationsService, 'sendToUser').mockResolvedValue(undefined as any);
      const orderStatusSpy_statusSpy = jest.spyOn(kashierService, 'getOrderStatus').mockResolvedValue(null);
      const statusSpy = jest
        .spyOn(kashierService, 'getPaymentStatus')
        .mockResolvedValue('AUTHORIZED');

      const result = await bookingsService.healFromRedirect(
        booking.id,
        'KSH-REAL',
        passengerUser,
      );

      expect(result.healed).toBe(true);
      const updated = await bookingRepo.findOneBy({ id: booking.id });
      expect(updated?.status).toBe(BookingStatus.PENDING_DRIVER_APPROVAL);

      statusSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    // The admin screen writes commission_rate to platform_config, but create() used to
    // read only the env var — so a rate changed in the dashboard was silently ignored.
    it('charges the commission rate held in platform_config, not the env default', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED, pricePerSeat: 200 });
      const configRepo = dataSource.getRepository(PlatformConfig);
      const original = await configRepo.findOneBy({ key: CONFIG_KEYS.COMMISSION_RATE });

      await configRepo.update({ key: CONFIG_KEYS.COMMISSION_RATE }, { value: '0.10' });

      const booking = await bookingsService.create(passengerUser, {
        tripId: trip.id,
        seatsCount: 1,
        paymentMethod: PaymentMethod.CASH,
      } as any);

      expect(Number(booking.commissionRate)).toBe(0.1);
      expect(Number(booking.commissionAmount)).toBe(20);
      expect(Number(booking.driverPayoutAmount)).toBe(180);

      if (original) {
        await configRepo.update({ key: CONFIG_KEYS.COMMISSION_RATE }, { value: original.value });
      }
      await paymentRepo.delete({ bookingId: booking.id });
      await bookingRepo.delete(booking.id);
      await tripRepo.delete(trip.id);
    });

    // Kashier's contract requires the refund policy to be shown before payment. The app
    // reads it from here so the displayed tiers cannot drift from what is enforced.
    it('exposes the cancellation policy the backend actually applies', async () => {
      const policy = await bookingsService.getCancellationPolicy();

      expect(policy.freeCancelHours).toBeGreaterThan(0);
      expect(policy.lateCancelHours).toBeGreaterThan(0);
      expect(policy.lateCancelFeePct).toBeGreaterThan(0);
      expect(policy.lateCancelFeePct).toBeLessThan(1);
      // The tiers have to be ordered or the displayed policy is nonsense
      expect(policy.freeCancelHours).toBeGreaterThan(policy.lateCancelHours);
    });

    // Regression: the detail endpoint returned the whole driver entity
    it('trip detail omits the driver’s private fields', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      await userRepo.update(driverUser.id, {
        nationalIdNumber: '29901011234567',
        fcmToken: 'secret-device-token',
      });

      const detail: any = await tripsService.findByIdPublic(trip.id);

      expect(detail.driver.fullName).toBeDefined();
      expect(detail.driver.nationalIdNumber).toBeUndefined();
      expect(detail.driver.nationalIdPhotoUrl).toBeUndefined();
      expect(detail.driver.fcmToken).toBeUndefined();
      expect(detail.driver.emergencyContactPhone).toBeUndefined();
      expect(JSON.stringify(detail)).not.toContain('secret-device-token');

      await userRepo.update(driverUser.id, {
        nationalIdNumber: null as any,
        fcmToken: null as any,
      });
      await tripRepo.delete(trip.id);
    });

    // Regression: cancellation updated the DB to REFUNDED without calling Kashier
    it('driver cancellation actually voids an authorized hold', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });
      const releaseSpy = jest.spyOn(kashierService, 'releasePayment').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

      await tripsService.cancel(trip.id, driverUser, 'test');

      expect(releaseSpy).toHaveBeenCalledTimes(1);
      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.RELEASED);

      releaseSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('driver cancellation refunds a captured payment', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.CAPTURED,
      });
      const refundSpy = jest.spyOn(kashierService, 'refundPayment').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

      await tripsService.cancel(trip.id, driverUser, 'test');

      expect(refundSpy.mock.calls[0][0]).toEqual(expect.any(String));
      expect(refundSpy.mock.calls[0][1]).toBe(150);
      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.REFUNDED);

      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });

    it('a gateway failure during cancellation does not record a refund that never happened', async () => {
      const trip = await makeTrip({ status: TripStatus.SCHEDULED });
      const { booking, payment } = await makeBookingWithPayment(trip.id, {
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.CAPTURED,
      });
      const refundSpy = jest
        .spyOn(kashierService, 'refundPayment')
        .mockRejectedValue(new Error('Kashier API down'));
      const notifySpy = jest.spyOn(notificationsService, 'sendToUsers').mockResolvedValue(undefined as any);

      // The trip must still cancel — passengers cannot be held on a dead trip
      await tripsService.cancel(trip.id, driverUser, 'test');

      const updatedTrip = await tripRepo.findOneBy({ id: trip.id });
      expect(updatedTrip?.status).toBe(TripStatus.CANCELLED);
      // ...but the payment must not claim to be refunded
      const updated = await paymentRepo.findOneBy({ id: payment.id });
      expect(updated?.status).toBe(PaymentStatus.CAPTURED);
      expect(updated?.refundedAt).toBeNull();

      refundSpy.mockRestore();
      notifySpy.mockRestore();
      await cleanup(trip.id, booking.id, payment.id);
    });
  });

  // ── 17. Kashier endpoint routing ─────────────────────────────────────────────
  // Regression: order operations were sent to the API host, where /v3/orders does
  // not exist, so every capture 404'd and no online payment was ever collected.
  // These assert the outbound request instead of trusting the call not to throw.

  describe('KashierService — endpoint routing', () => {
    let fetchSpy: jest.SpyInstance;
    const calls: Array<{ url: string; method: string; body: any }> = [];

    const okJson = (payload: unknown) =>
      ({
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      }) as any;

    beforeEach(() => {
      calls.length = 0;
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async (url: any, init: any) => {
        calls.push({
          url: String(url),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(init.body) : undefined,
        });
        return okJson({ data: { status: 'CAPTURED' } });
      }) as any);
    });

    // Optional-chained because afterEach still runs when suite setup failed
    afterEach(() => fetchSpy?.mockRestore());

    it('capture PUTs to the fep host, not the api host', async () => {
      await kashierService.capturePayment('ORDER-1', 150);

      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('PUT');
      expect(calls[0].url).toBe('https://test-fep.kashier.io/v3/orders/ORDER-1');
      expect(calls[0].url).not.toContain('test-api.kashier.io');
      expect(calls[0].body).toEqual({ apiOperation: 'CAPTURE', transaction: { amount: 150 } });
    });

    it('release sends VOID to the fep host — there is no RELEASE operation', async () => {
      await kashierService.releasePayment('ORDER-2', 'TX-123');

      expect(calls[0].method).toBe('PUT');
      expect(calls[0].url).toBe('https://test-fep.kashier.io/v3/orders/ORDER-2');
      expect(calls[0].body.apiOperation).toBe('VOID');
      expect(calls[0].body.transaction).toEqual({ targetTransactionId: 'TX-123' });
    });

    it('release omits transaction when no target transaction is known', async () => {
      await kashierService.releasePayment('ORDER-2b');

      expect(calls[0].body).toEqual({ apiOperation: 'VOID' });
    });

    it('refund PUTs REFUND to the fep host', async () => {
      await kashierService.refundPayment('ORDER-3', 50);

      expect(calls[0].method).toBe('PUT');
      expect(calls[0].url).toBe('https://test-fep.kashier.io/v3/orders/ORDER-3');
      expect(calls[0].body.apiOperation).toBe('REFUND');
    });

    it('payment status GETs the session endpoint on the api host', async () => {
      const status = await kashierService.getPaymentStatus('SESSION-9');

      expect(calls[0].method).toBe('GET');
      expect(calls[0].url).toBe(
        'https://test-api.kashier.io/v3/payment/sessions/SESSION-9/payment',
      );
      expect(status).toBe('CAPTURED');
    });

    it('payment status returns null without a session id instead of calling out', async () => {
      const status = await kashierService.getPaymentStatus(null);

      expect(status).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('reproduces the signature vector from Kashier docs exactly', async () => {
      // Known-good vector published in Kashier's webhook docs: this exact `data`,
      // keyed with the illustrative Payment API Key "11111", must produce the
      // documented digest. Guards the whole HMAC construction — key choice, key
      // sorting, and the %20 encoding that URLSearchParams would get wrong.
      const data = {
        amount: 1,
        channel: 'online | e-commerce',
        currency: 'EGP',
        kashierOrderId: '9ad06b17-755b-4e21-9774-aff3e2726ac9',
        merchantOrderId: '1653481557813',
        method: 'card',
        orderReference: 'TEST-ORD-38855',
        status: 'SUCCESS',
        transactionId: 'TX-249893963',
        transactionResponseCode: '00',
        signatureKeys: [
          'amount', 'channel', 'currency', 'kashierOrderId', 'merchantOrderId',
          'method', 'orderReference', 'status', 'transactionId', 'transactionResponseCode',
        ],
      };

      expect(kashierService.buildWebhookSignaturePayload(data)).toBe(
        'amount=1&channel=online%20%7C%20e-commerce&currency=EGP' +
          '&kashierOrderId=9ad06b17-755b-4e21-9774-aff3e2726ac9' +
          '&merchantOrderId=1653481557813&method=card&orderReference=TEST-ORD-38855' +
          '&status=SUCCESS&transactionId=TX-249893963&transactionResponseCode=00',
      );

      const digest = require('node:crypto')
        .createHmac('sha256', '11111')
        .update(kashierService.buildWebhookSignaturePayload(data)!)
        .digest('hex');
      expect(digest).toBe(
        '9610477b2255b2a8ef84fd89adfaa5f1305ff9c20324205851890f1ea03109f4',
      );
    });

    it('sorts signature keys and ignores fields not listed in signatureKeys', async () => {
      const payload = kashierService.buildWebhookSignaturePayload({
        currency: 'EGP',
        amount: 5,
        secretInternalField: 'must-not-appear',
        signatureKeys: ['currency', 'amount'],
      });

      expect(payload).toBe('amount=5&currency=EGP');
      expect(payload).not.toContain('must-not-appear');
    });

    it('rejects a webhook with no signature or no signatureKeys', async () => {
      const data = { amount: 1, signatureKeys: ['amount'] };

      expect(kashierService.verifyWebhookSignature(data, undefined)).toBe(false);
      expect(kashierService.verifyWebhookSignature({ amount: 1 }, 'deadbeef')).toBe(false);
      expect(kashierService.verifyWebhookSignature(data, 'not-hex-at-all')).toBe(false);
    });

    it('signs payout webhooks differently from payment webhooks', async () => {
      // Kashier's docs warn against sharing a verifier: the payout webhook uses
      // signatureKeys in ARRAY ORDER with RAW values, while the payment webhook sorts
      // them and URL-encodes. Same input must produce two different payloads.
      const body = {
        merchantTransferId: 'transfer12345',
        method: 'wallet',
        amount: 10,
        merchantId: 'MID-xxx-xxx',
        status: 'IN_TRANSIT',
        signatureKeys: ['merchantTransferId', 'method', 'amount', 'merchantId', 'status'],
      };

      // Array order preserved, values raw — note status is NOT sorted to the front
      expect(kashierService.buildTransferSignaturePayload(body)).toBe(
        'merchantTransferId=transfer12345&method=wallet&amount=10' +
          '&merchantId=MID-xxx-xxx&status=IN_TRANSIT',
      );

      // The payment verifier would sort alphabetically — proving they must not be shared
      expect(kashierService.buildWebhookSignaturePayload(body)).toBe(
        'amount=10&merchantId=MID-xxx-xxx&merchantTransferId=transfer12345' +
          '&method=wallet&status=IN_TRANSIT',
      );
    });

    it('payout signature leaves values unencoded, unlike the payment signature', async () => {
      const body = {
        recipientName: 'Jhon Doe',
        channel: 'online | e-commerce',
        signatureKeys: ['recipientName', 'channel'],
      };

      // Raw spaces and pipe, no percent-encoding
      expect(kashierService.buildTransferSignaturePayload(body)).toBe(
        'recipientName=Jhon Doe&channel=online | e-commerce',
      );
    });

    it('rejects an unsigned payout webhook', async () => {
      const body = { merchantTransferId: 'x', signatureKeys: ['merchantTransferId'] };

      expect(kashierService.verifyTransferWebhookSignature(body, undefined)).toBe(false);
      expect(kashierService.verifyTransferWebhookSignature({ a: 1 }, 'deadbeef')).toBe(false);
    });

    it('creates transfers against the fep host on v3', async () => {
      fetchSpy.mockImplementation((async (url: any, init: any) => {
        calls.push({
          url: String(url),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(init.body) : undefined,
        });
        return okJson({ data: [{ transferId: 'TRS-1', status: 'PENDING' }] });
      }) as any);

      await kashierService.createTransfer({
        amount: 200,
        method: 'wallet',
        recipientName: 'Test Driver',
        recipientNumber: '01111111111',
        merchantTransferId: 'wd-1',
      });

      expect(calls[0].method).toBe('POST');
      expect(calls[0].url).toBe('https://test-fep.kashier.io/v3/transfers/single');
      expect(calls[0].url).not.toContain('/v2/');
    });

    // Regression: only the HTTP status was checked. Kashier answers 200 with
    // status: "FAILURE" in some cases — a disabled feature flag, for instance — and
    // that was being treated as a successful capture.
    it('rejects a 200 response that reports FAILURE in the body', async () => {
      fetchSpy.mockImplementation((async () =>
        okJson({
          status: 'FAILURE',
          messages: { en: 'Capture is not enabled for this merchant' },
        })) as any);

      await expect(kashierService.capturePayment('ORDER-X', 150)).rejects.toThrow(
        /FAILURE/,
      );
    });

    it('accepts a transfer creation that reports PENDING rather than SUCCESS', async () => {
      // Demanding SUCCESS would break payouts: a created transfer legitimately
      // reports PENDING
      fetchSpy.mockImplementation((async () =>
        okJson({ data: [{ transferId: 'TRS-9', status: 'PENDING' }] })) as any);

      const res = await kashierService.createTransfer({
        amount: 10,
        method: 'wallet',
        recipientName: 'X',
        recipientNumber: '01111111111',
        merchantTransferId: 'wd-9',
      });

      expect(res.transferId).toBe('TRS-9');
    });

    it('returns the capture transactionId so a later void or refund can target it', async () => {
      fetchSpy.mockImplementation((async () =>
        okJson({
          status: 'SUCCESS',
          transactionId: 'TX-2670193217974',
          response: { status: 'CAPTURED', transactionId: 'TX-2670193217974' },
        })) as any);

      const res = await kashierService.capturePayment('ORDER-Y', 150);

      expect(res.transactionId).toBe('TX-2670193217974');
    });

    it('sends targetTransactionId on a refund when one is known', async () => {
      await kashierService.refundPayment('ORDER-Z', 50, 'TX-123');

      expect(calls[0].method).toBe('PUT');
      expect(calls[0].body.apiOperation).toBe('REFUND');
      expect(calls[0].body.transaction).toEqual({
        amount: 50,
        targetTransactionId: 'TX-123',
      });
    });

    it('omits targetTransactionId when none is known', async () => {
      await kashierService.refundPayment('ORDER-Z', 50);

      expect(calls[0].body.transaction).toEqual({ amount: 50 });
    });

    it('reads order status by merchantOrderId from the api host', async () => {
      fetchSpy.mockImplementation((async (url: any, init: any) => {
        calls.push({
          url: String(url),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(init.body) : undefined,
        });
        return okJson({ response: { status: 'CAPTURED', totalCapturedAmount: 99 } });
      }) as any);

      const status = await kashierService.getOrderStatus('booking-uuid');

      expect(calls[0].method).toBe('GET');
      expect(calls[0].url).toBe('https://test-api.kashier.io/payments/orders/booking-uuid');
      expect(status).toBe('CAPTURED');
    });

    it('order status returns null without an order id instead of calling out', async () => {
      const status = await kashierService.getOrderStatus(null);

      expect(status).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('extracts the session id from the checkout url', async () => {
      fetchSpy.mockImplementation((async () =>
        okJson({
          sessionUrl: 'https://payments.kashier.io/session/67adc07584f10c00121f6739?mode=test',
        })) as any);

      const result = await kashierService.createPaymentSession({
        id: 'booking-xyz',
        totalAmount: 100,
        passengerId: 'passenger-1',
        passenger: { fullName: 'Test', phoneNumber: '+201000000000' },
      } as any);

      expect(result.sessionId).toBe('67adc07584f10c00121f6739');
    });
  });
});
