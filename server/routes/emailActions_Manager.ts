import express, { Request, Response } from 'express';
import { PoolConnection } from 'mysql2/promise';
import pool from '../configuration/db';
import emailService from '../utils/emailService';

const router = express.Router();

// Process email approval/rejection links
router.get('/:action/:token', async (req: Request, res: Response): Promise<void> => {
    const { action, token } = req.params;

    if (action !== 'approve' && action !== 'reject') {
        res.status(400).json({
            success: false,
            message: 'Invalid action'
        });
        return;
    }

    const connection: PoolConnection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Find and validate the token
        const [tokens]: any[] = await connection.execute(
            "SELECT * FROM email_action_tokens WHERE token = ? AND used = 0 AND expires > NOW()",
            [token]
        );

        if (tokens.length === 0) {
            res.status(400).json({
                success: false,
                message: 'Invalid or expired email-action token'
            });
            return;
        }

        const tokenRecord: any = tokens[0];

        // Get booking details
        const [bookings]: any[] = await connection.execute(
            'SELECT * FROM bookings WHERE id = ?',
            [tokenRecord.booking_id]
        );

        if (bookings.length === 0) {
            res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
            return;
        }

        const booking: any = bookings[0];

        // Check if booking status is still pending (hasn't been already processed)
        if (booking.status !== 'pending') {
            // Mark token as used since it can't be used anymore
            await connection.execute(
                'UPDATE email_action_tokens SET used = 1, used_at = NOW() WHERE id = ?',
                [tokenRecord.id]
            );

            await connection.commit();

            res.status(400).json({
                success: false,
                message: `This booking has already been processed. Its current status is: ${booking.status}`,
                currentStatus: booking.status
            });
            return;
        }

        // Process the action
        if (action === 'approve') {
            // Approve booking
            await connection.execute(
                'UPDATE bookings SET status = "approved" WHERE id = ?',
                [booking.id]
            );
        } else if (action === 'reject') {
            // Reject booking
            await connection.execute(
                'CALL AdminRejectOrCancelBooking(?, ?)',
                [booking.id, 'rejected']
            );
        }

        // Mark token as used
        await connection.execute(
            'UPDATE email_action_tokens SET used = 1, used_at = NOW() WHERE id = ?',
            [tokenRecord.id]
        );

        // Get infrastructure details
        const [infrastructures]: any[] = await connection.execute(
            'SELECT * FROM infrastructures WHERE id = ?',
            [booking.infrastructure_id]
        );

        // Send notification to user
        if (infrastructures.length > 0) {
            await emailService.sendBookingStatusUpdate(
                booking,
                infrastructures[0],
                action === 'approve' ? 'approved' : 'rejected'
            );
        }

        await connection.commit();

        // Return success response
        res.json({
            success: true,
            message: `Booking ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
            action
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error processing email action:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing the action'
        });
    } finally {
        connection.release();
    }
});

export default router;