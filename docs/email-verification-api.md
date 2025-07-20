# Email Verification API Documentation

### Required Environment Variables
```env
# JWT Configuration
JWT_SECRET=your_jwt_secret_key

# Email Verification Settings
EMAIL_VERIFICATION_EXPIRES=86400000  # 24 hours in milliseconds
FREE_USER_CREDITS=10                 # Initial credits for new users

# Email Service Configuration (for Nodemailer)
EMAIL_HOST=smtp.gmail.com           # SMTP host
EMAIL_PORT=587                      # SMTP port
EMAIL_USER=your_email@gmail.com     # SMTP username
EMAIL_PASS=your_app_specific_password  # SMTP password
EMAIL_FROM='"Your App" <your_email@gmail.com>'  # From email address

# Frontend URL (for email links)
FRONTEND_URL=http://localhost:3000  # Your frontend application URL

# Optional Configuration
NODE_ENV=development                # Environment (development/production)
```

### Environment Variables Description:

1. **JWT Configuration**
   - `JWT_SECRET`: Secret key for signing JWT tokens. Must be a strong, random string.

2. **Email Verification Settings**
   - `EMAIL_VERIFICATION_EXPIRES`: Time in milliseconds before verification tokens expire.
   - `FREE_USER_CREDITS`: Number of credits given to new users upon registration.

3. **Email Service Configuration**
   - `EMAIL_HOST`: SMTP server host.
   - `EMAIL_PORT`: SMTP server port.
   - `EMAIL_USER`: Email account username.
   - `EMAIL_PASS`: Email account password or app-specific password.
   - `EMAIL_FROM`: The "From" address shown in emails.

4. **Application URLs**
   - `FRONTEND_URL`: Your frontend application URL, used for constructing verification links.

5. **General Configuration**
   - `NODE_ENV`: Application environment. Affects error message detail level.

### Security Notes:
1. Never commit `.env` file to version control
2. Use strong, unique values for `JWT_SECRET`
3. For production, use secure email service credentials
4. In production, ensure `FRONTEND_URL` uses HTTPS
5. Consider using app-specific passwords for email services that support it


## 1. Register User
Creates a new user account and sends a verification email.

**Endpoint:** `POST /api/auth/register`

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Success Response (201):**
```json
{
  "message": "User registered successfully. Please check your email to verify your account.",
  "user": {
    "name": "John Doe",
    "email": "user@example.com",
    "isEmailVerified": false,
    "credits": 10,
    "role": "user",
    "subscription": {
      "type": "free",
      "status": "none",
      "secondsUsed": 0
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Alternative Success Response (201)** - If email sending fails:
```json
{
  "message": "User registered successfully but failed to send verification email. Please request a new verification email.",
  "user": {
    // Same user object as above
  }
}
```

**Error Responses:**
- `400 Bad Request`:
```json
{
  "error": "Email already in use",
  "details": "A user with this email already exists"
}
```
- `500 Server Error`:
```json
{
  "error": "Server error",
  "details": "An error occurred during registration"
}
```

## 2. Verify Email
Verifies a user's email address using the token received in email.

**Endpoint:** `GET /api/auth/verify-email/:token`

**Parameters:**
- `token`: The verification token received in email (URL parameter)

**Success Response (200):**
```json
{
  "message": "Email verified successfully",
  "token": "jwt_token_here",
  "user": {
    // User object with all non-sensitive fields
  },
  "remainingSeconds": 600
}
```

**Error Responses:**
- `400 Bad Request`:
```json
{
  "error": "Missing token",
  "details": "Verification token is required"
}
```
- `400 Bad Request`:
```json
{
  "error": "Invalid or expired token",
  "details": "Email verification token is invalid or expired"
}
```

## 3. Resend Verification Email
Requests a new verification email for an unverified account.

**Endpoint:** `POST /api/auth/resend-verification`

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "message": "Verification email sent successfully",
  "details": "Please check your email for verification instructions"
}
```

**Error Responses:**
- `404 Not Found`:
```json
{
  "error": "User not found",
  "details": "User with this email does not exist"
}
```
- `400 Bad Request`:
```json
{
  "error": "Email already verified",
  "details": "User with this email is already verified"
}
```
- `429 Too Many Requests`:
```json
{
  "error": "Too many requests",
  "details": "Please wait X seconds before requesting another email",
  "retryAfter": 300 // seconds to wait
}
```
- `400 Bad Request` (After 5 attempts):
```json
{
  "error": "Too many verification attempts",
  "details": "Please contact support to verify your account",
  "requiresSupport": true
}
```

### Notes:
- Verification tokens expire after 24 hours (controlled by `EMAIL_VERIFICATION_EXPIRES` env variable)
- There is a 5-minute cooldown between verification email requests
- Maximum 5 verification attempts allowed before requiring support intervention
- Email verification is required before login is allowed
- Google OAuth users are automatically verified
- All endpoints return appropriate error messages if something goes wrong

### Security Features:
1. Rate limiting on verification requests (5-minute cooldown)
2. Attempt tracking (max 5 attempts)
3. Secure token generation using crypto
4. Token expiration (24 hours)
5. Privacy-focused error messages