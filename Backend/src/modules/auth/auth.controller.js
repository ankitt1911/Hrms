const { success } = require('../../common/http/response');
const service = require('./auth.service');
const Session = require('./session.model');

const login = async (req, res) => success(res, await service.login(req.validated.body, { ip: req.ip, userAgent: req.get('user-agent') }), 'Login successful');
const refresh = async (req, res) => success(res, await service.refresh(req.validated.body.refreshToken), 'Session refreshed');
const logout = async (req, res) => { await service.revokeSession(req.actor.sessionId, req.actor.userId); return success(res, null, 'Logged out'); };
const logoutAll = async (req, res) => { await service.revokeAll(req.actor.userId); return success(res, null, 'All sessions revoked'); };
const forgot = async (req, res) => { await service.forgotPassword(req.validated.body); return success(res, null, 'If the account exists, reset instructions have been sent'); };
const requestOtp = async (req, res) => { await service.requestOtp(req.validated.body); return success(res, null, 'If the account exists, a verification code has been sent'); };
const verifyOtp = async (req, res) => success(res, await service.verifyOtp(req.validated.body), 'Verification successful');
const reset = async (req, res) => { await service.resetPassword(req.validated.body.token, req.validated.body.newPassword); return success(res, null, 'Password reset successfully'); };
const change = async (req, res) => { await service.changePassword(req.actor.userId, req.validated.body.currentPassword, req.validated.body.newPassword); return success(res, null, 'Password changed; sign in again'); };
const sessions = async (req, res) => success(res, await Session.find({ userId: req.actor.userId, revokedAt: null, expiresAt: { $gt: new Date() } }).select('deviceId userAgent lastUsedAt createdAt expiresAt').sort('-createdAt'));
const revoke = async (req, res) => { await service.revokeSession(req.validated.params.id, req.actor.userId, 'USER_REVOKED'); return success(res, null, 'Session revoked'); };
const me = async (req, res) => success(res, await service.publicProfile(req.authUser));
const updateMe = async (req, res) => { Object.assign(req.authUser, req.validated.body); await req.authUser.save(); return success(res, await service.publicProfile(req.authUser), 'Profile updated'); };
module.exports = { login, refresh, logout, logoutAll, forgot, requestOtp, verifyOtp, reset, change, sessions, revoke, me, updateMe };
