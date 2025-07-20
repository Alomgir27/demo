const nodemailer = require('nodemailer');
const logger = require('./logger');

const createTransporter = async () => {
  const transporterOptions = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_HOST_USER,
      pass: process.env.EMAIL_HOST_PASSWORD
    },
    timeout: 60000,
    connectionTimeout: 60000,
    tls: {
      rejectUnauthorized: false
    }
  };

  const transporter = nodemailer.createTransport(transporterOptions);
  
  try {
    await transporter.verify();
    return transporter;
  } catch (error) {
    logger.error(`SMTP verification failed: ${error.message}`);
    throw error;
  }
};

const sendResetPasswordEmail = async (user, resetToken) => {
  try {
    if (!user || !user.email || !resetToken) {
      throw new Error('Missing required parameters for sending reset email');
    }

    const transporter = await createTransporter();
    const resetURL = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"Audio Separator" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Password Reset Request</h1>
          <p>You requested a password reset. Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetURL}" 
               style="background-color: #4CAF50; 
                      color: white; 
                      padding: 12px 24px; 
                      text-decoration: none; 
                      border-radius: 4px;
                      display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>This link will expire in 1 hour.</p>
          <p style="color: #666;">If you didn't request this, please ignore this email.</p>
          <hr>
          <p style="font-size: 12px; color: #999;">
            This is an automated email, please do not reply.
          </p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Reset password email sent: ${info.messageId}`);
    return info;

  } catch (error) {
    logger.error(`Error sending reset password email: ${error.message}`);
    throw error;
  }
};

const sendVerifyEmail = async (user, verifyToken) => {
  try {
    if (!user || !user.email || !verifyToken) {
      throw new Error('Missing required parameters for sending verify email');
    }

    const transporter = await createTransporter();
    const verifyURL = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verifyToken}`;

    const mailOptions = {
      from: `"Audio Separator" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: 'Verify Your Email Address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Verify Your Email Address</h1>
          <p>Welcome to Audio Separator! Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyURL}" 
               style="background-color: #4CAF50; 
                      color: white; 
                      padding: 12px 24px; 
                      text-decoration: none; 
                      border-radius: 4px;
                      display: inline-block;">
              Verify Email
            </a>
          </div>
          <p>This link will expire in 24 hours.</p>
          <p style="color: #666;">If you didn't create an account with us, please ignore this email.</p>
          <hr>
          <p style="font-size: 12px; color: #999;">
            This is an automated email, please do not reply.
          </p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Verification email sent: ${info.messageId}`);
    return info;

  } catch (error) {
    logger.error(`Error sending verification email: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendResetPasswordEmail,
  sendVerifyEmail
};