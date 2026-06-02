require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create folders
['uploads', 'uploads/videos', 'uploads/thumbnails', 'uploads/trailers', 'uploads/ads', 'uploads/payments'].forEach(folder => {
    const dir = path.join(__dirname, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/agnews')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err));

// ========== EMAIL SETUP ==========
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'agasobanuyenews@gmail.com',
        pass: process.env.EMAIL_PASS || ''
    }
});

async function sendEmail(to, subject, html) {
    try {
        if (!process.env.EMAIL_PASS) { console.log('⚠️ Email not configured, skipping'); return false; }
        await transporter.sendMail({
            from: '"AGASOBANUYE MOVIES" <' + (process.env.EMAIL_USER || 'agasobanuyenews@gmail.com') + '>',
            to: to, subject: subject, html: html
        });
        console.log('✅ Email sent to ' + to);
        return true;
    } catch (err) {
        console.log('❌ Email failed:', err.message);
        return false;
    }
}

// ========== MODELS ==========
const DeviceSchema = new mongoose.Schema({
    deviceId: String, deviceName: String, ipAddress: String,
    lastLogin: { type: Date, default: Date.now }, loginCount: { type: Number, default: 1 }
});

const ViewRecordSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deviceId: String, viewedAt: { type: Date, default: Date.now }
});

const DownloadRecordSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deviceId: String, downloadedAt: { type: Date, default: Date.now }
});

const NotificationSchema = new mongoose.Schema({
    message: String, type: { type: String, enum: ['subscription', 'system', 'warning', 'success'], default: 'system' },
    read: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isEmailVerified: { type: Boolean, default: true },
    emailVerificationCode: String,
    emailVerificationExpires: Date,
    subscription: {
        plan: { type: String, enum: ['free', 'basic', 'standard', 'premium', 'ultimate'], default: 'free' },
        duration: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'yearly', 'none'], default: 'none' },
        expiresAt: { type: Date, default: null }, startDate: { type: Date, default: null },
        status: { type: String, enum: ['active', 'pending', 'expired', 'flagged', 'none'], default: 'none' },
        maxDevices: { type: Number, default: 6 }, approvedBy: String, approvedAt: Date
    },
    devices: [DeviceSchema], deviceCount: { type: Number, default: 0 },
    isFlagged: { type: Boolean, default: false }, flagReason: String,
    notifications: [NotificationSchema],
    myList: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Content' }],
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const PartSchema = new mongoose.Schema({
    partNumber: String, title: String, videoUrl: String,
    videoSource: { type: String, enum: ['upload', 'external', 'pixeldrain'], default: 'external' },
    views: { type: Number, default: 0 }, downloads: { type: Number, default: 0 }
});

const EpisodeSchema = new mongoose.Schema({
    episodeNumber: Number, title: String, description: String, videoUrl: String,
    videoSource: { type: String, enum: ['upload', 'external', 'pixeldrain'], default: 'external' },
    views: { type: Number, default: 0 }, downloads: { type: Number, default: 0 }
});

const SeasonSchema = new mongoose.Schema({
    seasonNumber: Number, title: String, episodes: [EpisodeSchema]
});

const ContentSchema = new mongoose.Schema({
    type: { type: String, enum: ['movie', 'series'], required: true },
    title: String, description: String, descriptionHTML: String, synopsis: String,
    category: { type: String, required: true },
    year: String, runtime: String, director: String, cast: String,
    translator: { type: String, default: 'Not translated' },
    language: { type: String, default: 'English' },
    country: { type: String, default: 'Rwanda' },
    thumbnailUrl: String, trailerUrl: String,
    accessLevel: { type: String, enum: ['free', 'basic', 'standard', 'premium', 'ultimate'], default: 'free' },
    quality: { type: String, enum: ['480p', '720p', '1080p', '2K', '4K'], default: '720p' },
    isTrending: { type: Boolean, default: false }, isLatest: { type: Boolean, default: false }, isFeatured: { type: Boolean, default: false },
    ageRating: { type: String, default: '13+' }, rating: { type: Number, default: 0 },
    views: { type: Number, default: 0 }, downloads: { type: Number, default: 0 },
    viewedBy: [ViewRecordSchema], downloadedBy: [DownloadRecordSchema],
    parts: [PartSchema], seasons: [SeasonSchema],
    comments: [{ userName: String, text: String, likes: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now } }],
    tags: [String], uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, uploadedByEmail: String,
    uploadedAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
});
const Content = mongoose.model('Content', ContentSchema);

const TransactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, userEmail: String, userFullName: String,
    phone: String, amount: Number, currency: { type: String, default: 'RWF' },
    plan: String, duration: String, paymentMethod: { type: String, default: 'momo' },
    screenshotUrl: String, senderName: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'archived'], default: 'pending' },
    adminNote: String, processedBy: String, createdAt: { type: Date, default: Date.now }, processedAt: Date
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const WithdrawalSchema = new mongoose.Schema({
    amount: Number, bankDetails: { bankName: String, accountNumber: String, accountName: String },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, requestedByEmail: String, requestedByName: String,
    status: { type: String, enum: ['pending', 'approved', 'completed', 'rejected'], default: 'pending' },
    processedBy: String, processedByEmail: String, adminNote: String,
    createdAt: { type: Date, default: Date.now }, completedAt: Date
});
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

const AdSchema = new mongoose.Schema({
    type: { type: String, enum: ['image', 'video', 'text'], required: true },
    title: String, description: String, mediaUrl: String, link: String,
    contactPhone: String, contactName: String, contactEmail: String, businessName: String,
    position: { type: String, enum: ['top', 'sidebar', 'between', 'footer'], default: 'sidebar' },
    isActive: { type: Boolean, default: true }, targetPlans: [String],
    impressions: { type: Number, default: 0 }, clicks: { type: Number, default: 0 },
    startDate: Date, endDate: Date, textSpeed: { type: String, default: 'normal' },
    createdBy: String, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
});
const Ad = mongoose.model('Ad', AdSchema);

// ========== MULTER ==========
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'thumbnail') cb(null, path.join(__dirname, 'uploads/thumbnails/'));
        else if (file.fieldname === 'trailer') cb(null, path.join(__dirname, 'uploads/trailers/'));
        else if (file.fieldname === 'adMedia') cb(null, path.join(__dirname, 'uploads/ads/'));
        else if (file.fieldname === 'paymentScreenshot') cb(null, path.join(__dirname, 'uploads/payments/'));
        else cb(null, path.join(__dirname, 'uploads/videos/'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// ========== MIDDLEWARE ==========
const authMiddleware = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '⛔ Access denied. Please login to continue.' });
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'agnews_final_secret_2026');
        const user = await User.findById(verified.id);
        if (!user) return res.status(401).json({ error: '⛔ User not found. Please login again.' });
        if (user.subscription.status === 'active' && user.subscription.expiresAt && new Date() > new Date(user.subscription.expiresAt)) {
            user.subscription.status = 'expired'; user.subscription.plan = 'free'; user.subscription.duration = 'none';
            user.notifications.push({ message: '⏰ Your subscription has expired. Renew to regain access.', type: 'warning' });
            await user.save();
        }
        const deviceId = req.header('X-Device-ID') || 'unknown';
        const existingDevice = user.devices.find(d => d.deviceId === deviceId);
        if (existingDevice) { existingDevice.lastLogin = new Date(); existingDevice.loginCount += 1; }
        else {
            if (user.role !== 'admin' && user.subscription.plan !== 'free' && user.devices.length >= user.subscription.maxDevices) {
                user.isFlagged = true; user.flagReason = 'Device limit exceeded (' + user.subscription.maxDevices + ' devices). Contact admin.';
                await user.save();
                return res.status(403).json({ error: '🚫 Device limit reached! Your account has been flagged.', flagged: true });
            }
            user.devices.push({ deviceId, deviceName: req.header('X-Device-Name') || 'Unknown', ipAddress: req.ip, lastLogin: new Date() });
            user.deviceCount = user.devices.length;
        }
        await user.save(); req.user = user; next();
    } catch (err) { res.status(401).json({ error: '⛔ Invalid session. Please login again.' }); }
};

const adminMiddleware = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '🔒 Admin access only.' });
    next();
};

const headAdminMiddleware = (req, res, next) => {
    if (!req.user || req.user.email !== 'agasobanuyenews@gmail.com') return res.status(403).json({ error: '👑 Only Head Admin can perform this action.' });
    next();
};

const checkAccessLevel = (userPlan, contentAccessLevel) => {
    const planLevels = { free: 0, basic: 1, standard: 2, premium: 3, ultimate: 4 };
    return (planLevels[userPlan] || 0) >= (planLevels[contentAccessLevel] || 0);
};

// ========== CREATE ADMINS ==========
async function createAdmins() {
    const admins = [
        { email: 'agasobanuyenews@gmail.com', password: 'Joselove@250', fullName: '🎩 Nirobwimba - Head Admin & CEO' },
        { email: 'vugatime@gmail.com', password: 'vugatime@123', fullName: '🎬 Vugatime Media - Content Director' }
    ];
    for (const admin of admins) {
        if (!await User.findOne({ email: admin.email })) {
            await User.create({
                email: admin.email, password: await bcrypt.hash(admin.password, 10), fullName: admin.fullName, role: 'admin',
                isEmailVerified: true,
                subscription: { plan: 'ultimate', duration: 'yearly', expiresAt: new Date('2030-12-31'), startDate: new Date(), status: 'active', maxDevices: 100 }
            });
            console.log('✅ Admin: ' + admin.email);
        }
    }
}

// ========== AUTH ROUTES ==========
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, fullName, phone } = req.body;
        if (!email || !password) return res.status(400).json({ error: '📧 Email and 🔒 password required!' });
        if (password.length < 6) return res.status(400).json({ error: '🔒 Password must be at least 6 characters!' });
        if (await User.findOne({ email })) return res.status(400).json({ error: '📧 Email already registered!' });
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationExpires = new Date(Date.now() + 30 * 60 * 1000);
        const user = await User.create({
            email, password: await bcrypt.hash(password, 10), fullName: fullName || 'Movie Lover 🍿', phone: phone || '',
            isEmailVerified: true, emailVerificationCode: verificationCode, emailVerificationExpires: verificationExpires,
            subscription: { plan: 'free', duration: 'none', startDate: new Date(), status: 'active', maxDevices: 6 },
            notifications: [{ message: '🎉 Welcome to AGASOBANUYE MOVIES! Enjoy streaming! 🍿', type: 'system' }]
        });
        sendEmail(email, 'Welcome to AGASOBANUYE MOVIES! 🎬',
            '<div style="background:#0a0a0a;color:#fff;padding:2rem;border-radius:20px;text-align:center;font-family:sans-serif">' +
            '<h1 style="color:#E53935">🎬 AGASOBANUYE MOVIES</h1><h2>Welcome ' + (fullName || 'Movie Lover') + '! 🍿</h2>' +
            '<p>Your account has been created successfully!</p>' +
            '<p>Verification code: <b>' + verificationCode + '</b> (only needed for subscriptions)</p>' +
            '<p style="color:#b3b3b3">📞 Need help? +250 795 064 502</p></div>');
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'agnews_final_secret_2026');
        res.status(201).json({ token, user: { id: user._id, email, role: user.role, fullName: user.fullName, subscription: user.subscription, isEmailVerified: true }, message: '🎉 Account created! Welcome! 🍿' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/verify-email', authMiddleware, async (req, res) => {
    try {
        const { code } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isEmailVerified) return res.json({ success: true, message: 'Email already verified!' });
        if (user.emailVerificationCode !== code) return res.status(400).json({ error: '❌ Invalid verification code.' });
        if (new Date() > user.emailVerificationExpires) return res.status(400).json({ error: '⏰ Verification code expired. Request a new one.' });
        user.isEmailVerified = true; user.emailVerificationCode = undefined; user.emailVerificationExpires = undefined;
        user.notifications.push({ message: '✅ Email verified successfully!', type: 'success' });
        await user.save();
        res.json({ success: true, message: '✅ Email verified!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/resend-verification', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isEmailVerified) return res.json({ success: true, message: 'Email already verified!' });
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        user.emailVerificationCode = verificationCode; user.emailVerificationExpires = new Date(Date.now() + 30 * 60 * 1000);
        await user.save();
        sendEmail(user.email, 'New Verification Code - AGNEWS', '<div style="background:#0a0a0a;color:#fff;padding:2rem;border-radius:20px;text-align:center;font-family:sans-serif"><h1 style="color:#E53935">🎬 AGASOBANUYE MOVIES</h1><p>Your new verification code is:</p><h1 style="color:#FFC107;font-size:3rem;letter-spacing:5px">' + verificationCode + '</h1></div>');
        res.json({ success: true, message: '📧 New code sent!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: '📧 Email and 🔒 password required!' });
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: '🔍 No account found with this email.' });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: '❌ Incorrect password.' });
        if (user.isFlagged && user.role !== 'admin') return res.status(403).json({ error: '🚫 Account under review: ' + user.flagReason, flagged: true });
        if (user.subscription.status === 'active' && user.subscription.expiresAt && new Date() > new Date(user.subscription.expiresAt)) {
            user.subscription.status = 'expired'; user.subscription.plan = 'free'; user.subscription.duration = 'none';
            user.devices = []; user.deviceCount = 0; user.isFlagged = false;
            user.notifications.push({ message: '⏰ Your subscription has expired.', type: 'warning' });
            await user.save();
        }
        const deviceId = req.header('X-Device-ID') || crypto.randomBytes(16).toString('hex');
        const existingDevice = user.devices.find(d => d.deviceId === deviceId);
        if (existingDevice) { existingDevice.lastLogin = new Date(); existingDevice.loginCount += 1; }
        else {
            if (user.role !== 'admin' && user.subscription.plan !== 'free' && user.devices.length >= user.subscription.maxDevices) {
                user.isFlagged = true; user.flagReason = 'Device limit exceeded (' + user.subscription.maxDevices + ' devices).';
                await user.save();
                return res.status(403).json({ error: '🚫 Maximum devices reached! Contact admin: +250 795 064 502', flagged: true });
            }
            user.devices.push({ deviceId, deviceName: req.header('X-Device-Name') || 'Unknown', ipAddress: req.ip, lastLogin: new Date() });
            user.deviceCount = user.devices.length;
        }
        await user.save();
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'agnews_final_secret_2026');
        let expiringSoon = false;
        if (user.subscription.status === 'active' && user.subscription.expiresAt) {
            const daysLeft = Math.ceil((new Date(user.subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            expiringSoon = daysLeft <= 2;
        }
        res.json({ token, user: { id: user._id, email: user.email, role: user.role, fullName: user.fullName, subscription: user.subscription, deviceCount: user.deviceCount, isEmailVerified: user.isEmailVerified }, expiringSoon, message: expiringSoon ? '⚠️ Subscription expiring soon!' : '🎬 Welcome back! 🍿' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');
    let expiryAlert = null;
    if (user.subscription.status === 'active' && user.subscription.expiresAt) {
        const daysLeft = Math.ceil((new Date(user.subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 2 && daysLeft > 0) expiryAlert = '⚠️ Your ' + user.subscription.plan.toUpperCase() + ' plan expires in ' + daysLeft + ' day(s)!';
        else if (daysLeft <= 0) expiryAlert = '⏰ Subscription expired. You are now on Free plan.';
    }
    const unreadNotifications = (user.notifications || []).filter(n => !n.read).length;
    res.json({ ...user.toObject(), expiryAlert, unreadNotifications });
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    res.json(user.notifications || []);
});

app.put('/api/notifications/read', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    user.notifications.forEach(n => n.read = true);
    await user.save();
    res.json({ success: true });
});

// ========== CONTENT ROUTES ==========
app.get('/api/contents', async (req, res) => {
    try {
        const { category, type, search } = req.query;
        let query = {};
        if (category) query.category = category;
        if (type) query.type = type;
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
        const contents = await Content.find(query).select('-parts.videoUrl -seasons.episodes.videoUrl').sort({ uploadedAt: -1 });
        res.json(contents);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contents/:id', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) return res.status(404).json({ error: '🎬 Content not found!' });
        const userId = req.user?.id || null;
        const deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
        let alreadyViewed = false;
        if (userId) { alreadyViewed = content.viewedBy && content.viewedBy.some(v => v.userId && v.userId.toString() === userId.toString()); }
        else { alreadyViewed = content.viewedBy && content.viewedBy.some(v => v.deviceId === deviceId); }
        if (!alreadyViewed) {
            content.views = (content.views || 0) + 1;
            if (!content.viewedBy) content.viewedBy = [];
            content.viewedBy.push({ userId: userId, deviceId: deviceId, viewedAt: new Date() });
            await content.save();
        }
        const related = await Content.find({ _id: { $ne: content._id }, category: content.category }).limit(12).select('-parts.videoUrl');
        res.json({ content, related });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contents/:id/download', authMiddleware, async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) return res.status(404).json({ error: 'Content not found' });
        const userPlan = req.user.subscription.plan || 'free';
        const userStatus = req.user.subscription.status || 'none';
        if (content.accessLevel !== 'free' && userStatus !== 'active') { return res.status(403).json({ error: '⏳ Your subscription is pending approval. Please wait for admin verification.' }); }
        if (!checkAccessLevel(userPlan, content.accessLevel)) { return res.status(403).json({ error: '🔒 Subscribe to ' + content.accessLevel.toUpperCase() + ' plan to download!' }); }
        const userId = req.user.id;
        let alreadyDownloaded = content.downloadedBy && content.downloadedBy.some(d => d.userId && d.userId.toString() === userId.toString());
        if (!alreadyDownloaded) {
            content.downloads = (content.downloads || 0) + 1;
            if (!content.downloadedBy) content.downloadedBy = [];
            content.downloadedBy.push({ userId: userId, deviceId: req.ip, downloadedAt: new Date() });
            await content.save();
        }
        let videoUrl = content.parts?.[0]?.videoUrl || content.seasons?.[0]?.episodes?.[0]?.videoUrl || '';
        res.json({ downloadUrl: videoUrl, quality: content.quality, message: '⬇️ Download started!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== COMMENTS ==========
app.get('/api/comments/:contentId', async (req, res) => { const content = await Content.findById(req.params.contentId); if (!content) return res.status(404).json({ error: 'Not found' }); res.json((content.comments || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); });
app.post('/api/comments/:contentId', async (req, res) => { const { userName, text } = req.body; if (!userName || !text) return res.status(400).json({ error: 'Name and comment required' }); const content = await Content.findById(req.params.contentId); if (!content) return res.status(404).json({ error: 'Not found' }); content.comments.push({ userName: userName.trim(), text: text.trim() }); await content.save(); res.json({ success: true }); });
app.post('/api/comments/:contentId/:commentId/like', async (req, res) => { const content = await Content.findById(req.params.contentId); const comment = content?.comments.id(req.params.commentId); if (!comment) return res.status(404).json({ error: 'Not found' }); comment.likes = (comment.likes || 0) + 1; await content.save(); res.json({ likes: comment.likes }); });

// ========== PLANS ==========
app.get('/api/plans', (req, res) => { res.json({ free: { name: '🆓 Free', weekly: 0, monthly: 0, quarterly: 0, yearly: 0, features: ['🎬 Free movies', '📢 Ads', '📱 480p'] }, basic: { name: '⭐ Basic', weekly: 300, monthly: 500, quarterly: 1200, yearly: 3000, features: ['🎬 Free+Basic', '📢 Fewer ads', '📱 720p', '⬇️ Download'] }, standard: { name: '🌟 Standard', weekly: 500, monthly: 1000, quarterly: 2500, yearly: 7000, features: ['🎬 Most movies', '📢 Very few ads', '📱 1080p', '⬇️ HD Download'] }, premium: { name: '💎 Premium', weekly: 1000, monthly: 2000, quarterly: 5000, yearly: 15000, features: ['🎬 Almost all', '📢 Almost no ads', '📱 2K'] }, ultimate: { name: '👑 Ultimate', weekly: 2000, monthly: 5000, quarterly: 12000, yearly: 30000, features: ['🎬 ALL movies', '🚫 NO ADS', '📱 4K', '👑 VIP'] } }); });

// ========== SUBSCRIBE ==========
app.post('/api/subscribe', authMiddleware, upload.single('paymentScreenshot'), async (req, res) => {
    try {
        const { plan, duration, phone, senderName, paymentMethod } = req.body;
        const plans = { basic: { weekly: 300, monthly: 500, quarterly: 1200, yearly: 3000 }, standard: { weekly: 500, monthly: 1000, quarterly: 2500, yearly: 7000 }, premium: { weekly: 1000, monthly: 2000, quarterly: 5000, yearly: 15000 }, ultimate: { weekly: 2000, monthly: 5000, quarterly: 12000, yearly: 30000 } };
        if (!plans[plan]?.[duration]) return res.status(400).json({ error: 'Invalid plan' });
        if (!phone || !senderName) return res.status(400).json({ error: 'Phone and name required' });
        const txn = await Transaction.create({ userId: req.user._id, userEmail: req.user.email, userFullName: req.user.fullName, phone, amount: plans[plan][duration], plan, duration, paymentMethod: paymentMethod || 'momo', screenshotUrl: req.file ? '/uploads/payments/' + req.file.filename : '', senderName, status: 'pending' });
        await User.findByIdAndUpdate(req.user._id, { 'subscription.status': 'pending', 'subscription.plan': plan, 'subscription.duration': duration });
        req.user.notifications.push({ message: '💳 Payment submitted! Waiting for admin approval.', type: 'subscription' });
        await req.user.save();
        res.json({ success: true, message: '✅ Payment submitted! Admin will verify within 24 hours.', transaction: txn });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== ADMIN ROUTES ==========
app.get('/api/admin/me', authMiddleware, adminMiddleware, async (req, res) => { const user = await User.findById(req.user.id).select('-password'); res.json({ ...user.toObject(), isHeadAdmin: user.email === 'agasobanuyenews@gmail.com' }); });

app.post('/api/admin/upload', authMiddleware, adminMiddleware, upload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'trailer', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    try {
        const { type, title, description, category, year, director, cast, translator, language, country, accessLevel, quality, ageRating, tags, isFeatured, isTrending, videoSource, externalLink, seasonNumber, episodeNumber, episodeTitle } = req.body;
        if (!req.files?.thumbnail?.[0]) return res.status(400).json({ error: '🖼️ Thumbnail required!' });
        if (!title || !description || !category || !year) return res.status(400).json({ error: 'Title, Description, Category, Year required!' });
        const data = { type: type || 'movie', title, description, category, year, director: director || '', cast: cast || '', translator: translator || 'Not translated', language: language || 'English', country: country || 'Rwanda', thumbnailUrl: '/uploads/thumbnails/' + req.files.thumbnail[0].filename, trailerUrl: req.files.trailer?.[0] ? '/uploads/trailers/' + req.files.trailer[0].filename : '', accessLevel: accessLevel || 'free', quality: quality || '720p', ageRating: ageRating || '13+', tags: tags ? tags.split(',').map(t => t.trim()) : [], isFeatured: isFeatured === 'true', isTrending: isTrending === 'true', isLatest: true, uploadedBy: req.user._id, uploadedByEmail: req.user.email };
        let videoUrl = '', videoSrc = videoSource || 'external';
        if (videoSrc === 'external' && externalLink?.trim()) videoUrl = externalLink.trim();
        else if (req.files?.video?.[0]) { videoUrl = '/uploads/videos/' + req.files.video[0].filename; videoSrc = 'upload'; }
        else return res.status(400).json({ error: '🎥 Video file or link required!' });
        if (data.type === 'movie') data.parts = [{ partNumber: '1', title: 'Full Movie', videoUrl, videoSource: videoSrc }];
        else data.seasons = [{ seasonNumber: parseInt(seasonNumber) || 1, title: 'Season ' + (seasonNumber || 1), episodes: [{ episodeNumber: parseInt(episodeNumber) || 1, title: episodeTitle || 'Episode 1', videoUrl, videoSource: videoSrc }] }];
        await Content.updateMany({}, { isLatest: false });
        const content = await Content.create(data);
        res.json({ success: true, content, message: '✅ Uploaded!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/contents/:id', authMiddleware, adminMiddleware, async (req, res) => { const c = await Content.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true }); if (!c) return res.status(404).json({ error: 'Not found' }); res.json({ success: true, content: c }); });
app.delete('/api/admin/contents/:id', authMiddleware, adminMiddleware, async (req, res) => { await Content.findByIdAndDelete(req.params.id); res.json({ success: true }); });

app.post('/api/admin/movies/:id/part', authMiddleware, adminMiddleware, upload.single('video'), async (req, res) => {
    try {
        console.log('Add Part Request:', req.params.id, req.body);
        const c = await Content.findById(req.params.id);
        if (!c || c.type !== 'movie') return res.status(400).json({ error: 'Movie not found' });
        const { partNumber, partTitle, videoSource, externalLink } = req.body;
        let videoUrl = '';
        if ((videoSource === 'external' || videoSource === 'pixeldrain') && externalLink && externalLink.trim()) videoUrl = externalLink.trim();
        else if (req.file) videoUrl = '/uploads/videos/' + req.file.filename;
        else return res.status(400).json({ error: 'Video file or link required!' });
        c.parts.push({ partNumber: partNumber || String(c.parts.length + 1), title: partTitle || 'Part ' + (c.parts.length + 1), videoUrl, videoSource: videoSource || 'external' });
        c.updatedAt = new Date();
        await c.save();
        console.log('Part added successfully:', videoUrl);
        res.json({ success: true, content: c, message: '✅ Part added!' });
    } catch (err) { console.error('Add Part Error:', err); res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/series/:id/episode', authMiddleware, adminMiddleware, upload.single('video'), async (req, res) => {
    try {
        console.log('Add Episode Request:', req.params.id, req.body);
        const c = await Content.findById(req.params.id);
        if (!c || c.type !== 'series') return res.status(400).json({ error: 'Series not found' });
        const { seasonNumber, episodeNumber, episodeTitle, videoSource, externalLink } = req.body;
        let videoUrl = '';
        if ((videoSource === 'external' || videoSource === 'pixeldrain') && externalLink && externalLink.trim()) videoUrl = externalLink.trim();
        else if (req.file) videoUrl = '/uploads/videos/' + req.file.filename;
        else return res.status(400).json({ error: 'Video file or link required!' });
        let season = c.seasons.find(s => s.seasonNumber === parseInt(seasonNumber));
        if (!season) { season = { seasonNumber: parseInt(seasonNumber), title: 'Season ' + seasonNumber, episodes: [] }; c.seasons.push(season); }
        season.episodes.push({ episodeNumber: parseInt(episodeNumber) || season.episodes.length + 1, title: episodeTitle || 'Episode ' + (season.episodes.length + 1), videoUrl, videoSource: videoSource || 'external' });
        c.updatedAt = new Date();
        await c.save();
        console.log('Episode added successfully:', videoUrl);
        res.json({ success: true, content: c, message: '✅ Episode added!' });
    } catch (err) { console.error('Add Episode Error:', err); res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/subscriptions', authMiddleware, adminMiddleware, async (req, res) => {
    const { status } = req.query; let query = {}; if (status) query.status = status;
    const transactions = await Transaction.find(query).sort({ createdAt: -1 });
    const pendingCount = await Transaction.countDocuments({ status: 'pending' });
    const archivedCount = await Transaction.countDocuments({ status: 'archived' });
    const approvedCount = await Transaction.countDocuments({ status: 'approved' });
    res.json({ transactions, pendingCount, archivedCount, approvedCount, totalRevenue: (await Transaction.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0 });
});

app.put('/api/admin/subscriptions/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { status, adminNote } = req.body;
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Not found' });
    txn.status = status; txn.adminNote = adminNote || ''; txn.processedBy = req.user.email; txn.processedAt = new Date(); await txn.save();
    const user = await User.findById(txn.userId);
    if (status === 'approved') {
        const days = { weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };
        const exp = new Date(); exp.setDate(exp.getDate() + (days[txn.duration] || 30));
        await User.findByIdAndUpdate(txn.userId, { subscription: { plan: txn.plan, duration: txn.duration, expiresAt: exp, startDate: new Date(), status: 'active', maxDevices: 6, approvedBy: req.user.email, approvedAt: new Date() }, isFlagged: false, devices: [], deviceCount: 0 });
        if (user) {
            user.notifications.push({ message: '✅ Your ' + txn.plan.toUpperCase() + ' subscription has been APPROVED! Enjoy streaming! 🎬', type: 'success' });
            await user.save();
            sendEmail(user.email, '✅ Subscription Approved!', '<div style="background:#0a0a0a;color:#fff;padding:2rem;border-radius:20px;text-align:center;font-family:sans-serif"><h1 style="color:#4CAF50">✅ Subscription Approved!</h1><h2>Your ' + txn.plan.toUpperCase() + ' plan is now active!</h2><p>Duration: ' + txn.duration + '</p><p>Expires: ' + exp.toLocaleDateString() + '</p><p style="color:#b3b3b3">Enjoy unlimited streaming! 🍿</p></div>');
        }
        res.json({ success: true, message: '✅ Approved! User notified.' });
    } else if (status === 'rejected') {
        await User.findByIdAndUpdate(txn.userId, { 'subscription.status': 'none', 'subscription.plan': 'free', 'subscription.duration': 'none' });
        if (user) { user.notifications.push({ message: '❌ Your subscription was rejected. Reason: ' + (adminNote || 'No reason provided'), type: 'warning' }); await user.save(); }
        res.json({ success: true, message: '❌ Rejected.' });
    } else if (status === 'archived') {
        if (user) { user.notifications.push({ message: '📦 Your subscription has been archived.', type: 'system' }); await user.save(); }
        res.json({ success: true, message: '📦 Archived.' });
    } else { res.json({ success: true, message: '✅ Updated.' }); }
});

app.get('/api/admin/flagged-users', authMiddleware, adminMiddleware, async (req, res) => { res.json(await User.find({ isFlagged: true }).select('-password')); });
app.put('/api/admin/flagged-users/:id', authMiddleware, adminMiddleware, async (req, res) => { const user = await User.findById(req.params.id); if (!user) return res.status(404).json({ error: 'Not found' }); if (req.body.action === 'clear') { user.isFlagged = false; user.devices = []; user.deviceCount = 0; } else if (req.body.action === 'terminate') { user.subscription = { plan: 'free', duration: 'none', status: 'expired', maxDevices: 6 }; } await user.save(); res.json({ success: true }); });
app.get('/api/admin/comments', authMiddleware, adminMiddleware, async (req, res) => { const contents = await Content.find({ 'comments.0': { $exists: true } }).select('title comments'); let all = []; contents.forEach(c => c.comments.forEach(cm => all.push({ _id: cm._id, contentId: c._id, contentTitle: c.title, userName: cm.userName, text: cm.text, likes: cm.likes || 0, createdAt: cm.createdAt }))); res.json(all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); });
app.delete('/api/admin/comments/:contentId/:commentId', authMiddleware, adminMiddleware, async (req, res) => { const c = await Content.findById(req.params.contentId); if (!c) return res.status(404).json({ error: 'Not found' }); c.comments = c.comments.filter(cm => cm._id.toString() !== req.params.commentId); await c.save(); res.json({ success: true }); });

app.get('/api/ads', async (req, res) => { res.json(await Ad.find({ isActive: true }).sort({ createdAt: -1 })); });
app.get('/api/admin/ads', authMiddleware, adminMiddleware, async (req, res) => { res.json(await Ad.find().sort({ createdAt: -1 })); });
app.post('/api/admin/ads', authMiddleware, adminMiddleware, upload.single('adMedia'), async (req, res) => { const { type, title, description, link, position, contactPhone, contactName, businessName, targetPlans } = req.body; let mediaUrl = req.file ? '/uploads/ads/' + req.file.filename : req.body.mediaUrl || ''; const ad = await Ad.create({ type, title, description: description || '', mediaUrl, link: link || '', position: position || 'sidebar', contactPhone: contactPhone || '', contactName: contactName || '', businessName: businessName || '', targetPlans: targetPlans ? targetPlans.split(',').map(p => p.trim()) : ['free'], createdBy: req.user.email }); res.json({ success: true, ad }); });
app.put('/api/admin/ads/:id', authMiddleware, adminMiddleware, async (req, res) => { await Ad.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }); res.json({ success: true }); });
app.delete('/api/admin/ads/:id', authMiddleware, adminMiddleware, async (req, res) => { await Ad.findByIdAndDelete(req.params.id); res.json({ success: true }); });

app.get('/api/admin/payments', authMiddleware, adminMiddleware, async (req, res) => { const transactions = await Transaction.find({ status: 'approved' }).sort({ createdAt: -1 }); const totalRevenue = transactions.reduce((s, t) => s + (t.amount || 0), 0); const withdrawals = await Withdrawal.find(); const totalWithdrawn = withdrawals.filter(w => w.status === 'completed').reduce((s, w) => s + (w.amount || 0), 0); const subscribers = await User.find({ role: 'user', 'subscription.status': 'active', 'subscription.expiresAt': { $gt: new Date() } }); res.json({ transactions, totalRevenue, totalWithdrawn, availableBalance: totalRevenue - totalWithdrawn, activeSubscribers: subscribers.length, subscribers }); });
app.post('/api/admin/withdraw', authMiddleware, adminMiddleware, async (req, res) => { const { amount, bankName, accountNumber, accountName } = req.body; const w = await Withdrawal.create({ amount, bankDetails: { bankName, accountNumber, accountName }, requestedBy: req.user._id, requestedByEmail: req.user.email, requestedByName: req.user.fullName }); res.json({ success: true, withdrawal: w }); });
app.get('/api/admin/withdrawals', authMiddleware, adminMiddleware, async (req, res) => { res.json(await Withdrawal.find().sort({ createdAt: -1 })); });
app.put('/api/admin/withdrawals/:id', authMiddleware, headAdminMiddleware, async (req, res) => { await Withdrawal.findByIdAndUpdate(req.params.id, { status: req.body.status, completedAt: new Date(), processedBy: req.user.fullName }); res.json({ success: true }); });
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => { const totalContent = await Content.countDocuments(); const totalUsers = await User.countDocuments({ role: 'user' }); const activeSubscribers = await User.countDocuments({ role: 'user', 'subscription.status': 'active', 'subscription.expiresAt': { $gt: new Date() } }); const pendingPayments = await Transaction.countDocuments({ status: 'pending' }); const flaggedUsers = await User.countDocuments({ isFlagged: true }); const views = await Content.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]); const downloads = await Content.aggregate([{ $group: { _id: null, total: { $sum: '$downloads' } } }]); const revenue = await Transaction.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]); res.json({ totalContent, totalMovies: await Content.countDocuments({ type: 'movie' }), totalSeries: await Content.countDocuments({ type: 'series' }), totalUsers, activeSubscribers, pendingPayments, flaggedUsers, totalViews: views[0]?.total || 0, totalDownloads: downloads[0]?.total || 0, totalComments: (await Content.aggregate([{ $unwind: '$comments' }, { $group: { _id: null, total: { $sum: 1 } } }]))[0]?.total || 0, activeAds: await Ad.countDocuments({ isActive: true }), totalRevenue: revenue[0]?.total || 0 }); });

app.post('/api/mylist/:contentId', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id); if (!user.myList.includes(req.params.contentId)) { user.myList.push(req.params.contentId); await user.save(); } res.json({ success: true }); });
app.delete('/api/mylist/:contentId', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id); user.myList = user.myList.filter(id => id.toString() !== req.params.contentId); await user.save(); res.json({ success: true }); });
app.get('/api/mylist', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id).populate('myList'); res.json(user.myList || []); });

// ========== PROXY STREAM ROUTE ==========
app.get('/stream/:id', async (req, res) => { try { const content = await Content.findById(req.params.id); if (!content) return res.status(404).send('Content not found'); const partIndex = parseInt(req.query.part) || 0; const seasonIndex = parseInt(req.query.season) || 0; const episodeIndex = parseInt(req.query.episode) || 0; let videoUrl = ''; if (content.type === 'movie' && content.parts && content.parts.length > partIndex) { videoUrl = content.parts[partIndex].videoUrl; } else if (content.type === 'series' && content.seasons && content.seasons[seasonIndex] && content.seasons[seasonIndex].episodes && content.seasons[seasonIndex].episodes[episodeIndex]) { videoUrl = content.seasons[seasonIndex].episodes[episodeIndex].videoUrl; } if (!videoUrl) return res.status(404).send('No video URL found'); if (videoUrl.includes('pixeldrain.com/u/')) { videoUrl = videoUrl.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/'); } if (videoUrl.startsWith('/uploads/')) { return res.redirect(videoUrl); } res.redirect(videoUrl); } catch (err) { console.error('Stream error:', err); res.status(500).send('Streaming error'); } });

// ========== CLEAN URL ROUTES ==========
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
app.get('/', (req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });
app.get('/admin', (req, res) => { const token = req.query.token; if (!token) return res.sendFile(path.join(publicPath, 'admin-login.html')); try { jwt.verify(token, process.env.JWT_SECRET || 'agnews_final_secret_2026'); res.sendFile(path.join(publicPath, 'admin.html')); } catch (err) { res.sendFile(path.join(publicPath, 'admin-login.html')); } });
app.get('/admin-login', (req, res) => { res.sendFile(path.join(publicPath, 'admin-login.html')); });
app.get('/admin.html', (req, res) => { res.redirect('/admin-login'); });
app.get('/index.html', (req, res) => { res.redirect('/'); });

// ========== START ==========
createAdmins().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => { console.log('\n🎬 AGASOBANUYE MOVIES | AGNEWS\n📍 Port: ' + PORT + '\n👑 Admin: agasobanuyenews@gmail.com / Joselove@250\n📧 Email: ' + (process.env.EMAIL_USER || 'Not configured') + '\n'); });
});
