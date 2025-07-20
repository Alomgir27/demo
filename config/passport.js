const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/User');
const logger = require('../utils/logger');

// Configure JWT strategy
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
};

passport.use(
  new JwtStrategy(jwtOptions, async (payload, done) => {
    try {
      // Find the user by id from JWT payload
      const user = await User.findById(payload.id);

      if (!user) {
        return done(null, false);
      }

      return done(null, user);
    } catch (error) {
      logger.error(`JWT strategy error: ${error.message}`);
      return done(error, false);
    }
  })
);

// Configure Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BACKEND_URL}/api/auth/google/callback`,
      scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists in our database
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          // User already exists, update profile data if needed
          user = await User.findByIdAndUpdate(
            user._id,
            {
              name: profile.displayName,
              profilePicture: profile.photos?.[0]?.value,
              isEmailVerified: true,
              updatedAt: Date.now()
            },
            { new: true }
          );

          return done(null, user);
        }

        // Check if email already exists to link accounts
        const existingEmailUser = await User.findOne({
          email: profile.emails?.[0]?.value
        });

        if (existingEmailUser) {
          // Link Google account to existing email account
          existingEmailUser.googleId = profile.id;
          existingEmailUser.profilePicture = existingEmailUser.profilePicture || profile.photos?.[0]?.value;
          existingEmailUser.isEmailVerified = true;
          existingEmailUser.updatedAt = Date.now();

          await existingEmailUser.save();

          return done(null, existingEmailUser);
        }

        // Create new user with Google account
        const newUser = await User.create({
          name: profile.displayName,
          email: profile.emails?.[0]?.value,
          googleId: profile.id,
          profilePicture: profile.photos?.[0]?.value,
          isEmailVerified: true,
          credits: Number(process.env.FREE_USER_CREDITS) || 0,
          subscription: {
            type: 'free',
            status: 'none'
          }
        });

        return done(null, newUser);
      } catch (error) {
        logger.error(`Google strategy error: ${error.message}`);
        return done(error, false);
      }
    }
  )
);

// Serialize and deserialize user for sessions
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    logger.error(`Deserialize user error: ${error.message}`);
    done(error, null);
  }
});

module.exports = passport; 