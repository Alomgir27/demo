const mongoose = require('mongoose');

const CreditTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['purchase', 'usage', 'adjustment', 'refund'],
    required: true
  },
  credits: {
    type: Number,
    required: true
  },
  amount: {
    type: Number, // USD amount for purchases/refunds, 0 for usage
    default: 0
  },
  description: {
    type: String
  },
  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'pending'
  },
  stripeSessionId: {
    type: String // For linking to Stripe session (if applicable)
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
});

module.exports = mongoose.model('CreditTransaction', CreditTransactionSchema);