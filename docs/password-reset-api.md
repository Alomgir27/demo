# Password Reset API Documentation

## 1. Request Password Reset
Initiates the password reset process by sending a reset link to the user's email.

**Endpoint:** `POST /api/auth/forgot-password`

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "message": "Password reset email sent successfully",
  "details": "Please check your email for reset instructions",
  "email": "user@example.com"
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
- `500 Server Error`:
```json
{
  "error": "Email error",
  "details": "There was an error sending the reset email"
}
```

## 2. Verify Reset Token
Verifies if a password reset token is valid and not expired.

**Endpoint:** `GET /api/auth/reset-password/:token`

**Parameters:**
- `token`: The reset token received in email (URL parameter)

**Success Response (200):**
```json
{
  "message": "Token is valid",
  "email": "user@example.com"
}
```

**Error Response (400):**
```json
{
  "error": "Invalid or expired token",
  "details": "Password reset token is invalid or expired"
}
```

## 3. Reset Password
Resets the user's password using a valid token.

**Endpoint:** `POST /api/auth/reset-password/:token`

**Parameters:**
- `token`: The reset token received in email (URL parameter)

**Request Body:**
```json
{
  "password": "newPassword123"
}
```

**Success Response (200):**
```json
{
  "message": "Password reset successful",
  "token": "jwt_token_for_authentication",
  "user": {
    // User object (without password)
  },
  "remainingSeconds": 3600
}
```

**Error Response (400):**
```json
{
  "error": "Invalid or expired token",
  "details": "Password reset token is invalid or expired"
}
```

### Notes:
- Reset tokens expire after 1 hour
- After successful password reset, the user is automatically logged in (JWT token provided)
- The reset token can only be used once
- All endpoints return appropriate error messages if something goes wrong
- The user's email with reset instructions includes a link that expires after 1 hour