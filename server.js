const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_super_aman_sepatu_2024';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'Penjualan_Sepatu';
let db, client;
let nextIds = { customers: 1, products: 1, orders: 1, payments: 1, stok_masuk: 1 };

// ========== INFO REKENING ==========
const BANK_INFO = {
    BCA: { nomor: '1234567890', atas_nama: 'ShoeStore Indonesia' },
    BNI: { nomor: '0987654321', atas_nama: 'ShoeStore Indonesia' },
    Mandiri: { nomor: '1122334455', atas_nama: 'ShoeStore Indonesia' }
};

// ==========================================
//  KONEKSI DB 
// ==========================================
async function connectDB() {
    if (db) return true;

    console.log('Menghubungkan ke MongoDB...');
    try {
        if (!uri) {
            console.error('ERROR: MONGODB_URI tidak ditemukan di Environment Variables!');
            return false;
        }

        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000
        });
        await client.connect();
        db = client.db(dbName);

        await db.command({ ping: 1 });
        console.log('Terhubung ke MongoDB — Database:', dbName);

        // Inisialisasi nextIds dari data yang sudah ada
        for (const col of ['customers', 'products', 'orders', 'payments', 'stok_masuk']) {
            try {
                const max = await db.collection(col).find({}).sort({ id: -1 }).limit(1).toArray();
                if (max.length > 0) {
                    nextIds[col] = max[0].id + 1;
                }
            } catch (e) {}
        }

        // Buat admin default
        const adminExists = await db.collection('users').findOne({ email: 'admin@sepatu.com' });
        if (!adminExists) {
            await db.collection('users').insertOne({
                name: 'Administrator',
                email: 'admin@sepatu.com',
                password: 'admin123',
                role: 'admin'
            });
        }

        return true;
        } catch (err) {
        console.error('GAGAL KONEKSI MONGODB:', err.message);
        db = null;
        throw err; // <-- UBAH YANG INI
    }
}

// ========== ROUTES ==========
app.get('/', (req, res) => {
    if (db) {
        res.send('Server Penjualan Sepatu Berjalan! Database Terhubung.');
    } else {
        res.send('Server Berjalan, tapi database belum terhubung. Akses /api/ping untuk inisialisasi.');
    }
});

app.get('/api/ping', async (req, res) => {
    try {
        if (!uri) return res.json({ error: 'MONGODB_URI KOSONG DI VERCEL!' });
        const connected = await connectDB();
        res.json({
            status: connected ? 'OK' : 'NO_DB',
            db: connected ? dbName : 'null',
            time: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ 
            error: err.message, 
            uri_preview: uri ? uri.substring(0, 40) + '...' : 'TIDAK ADA' 
        });
    }
});

app.get('/api/bank-info', (req, res) => {
    res.json(BANK_INFO);
});

// ========== MIDDLEWARE ==========
const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Akses ditolak' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token tidak valid' });
        req.user = user;
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya Admin' });
    next();
};

const requireDB = async (req, res, next) => {
    if (!db) {
        const connected = await connectDB();
        if (!connected) {
            return res.status(503).json({ error: 'Database belum terhubung. Cek koneksi MongoDB.' });
        }
    }
    next();
};

// ========== AUTH ==========
app.post('/api/login', requireDB, async (req, res) => {
    try {
        const { email, password } = req.body;
        let user = await db.collection('users').findOne({ email, password });
        if (!user) {
            user = await db.collection('customers').findOne({ email, password });
        }
        if (!user) return res.status(401).json({ error: 'Email atau password salah' });

        const token = jwt.sign({ id: user.id || user._id, email: user.email, role: user.role || 'customer' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { name: user.name, email: user.email, role: user.role || 'customer' } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/register', requireDB, async (req, res) => {
    try {
        const { name, email, password, alamat } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'Semua field wajib diisi' });

        const existing = await db.collection('customers').findOne({ email });
        if (existing) return res.status(400).json({ error: 'Email sudah terdaftar' });

        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Email sudah terdaftar' });

        const customerId = nextIds.customers++;
        const customer = { id: customerId, name, email, password, alamat: alamat || '-' };
        await db.collection('customers').insertOne(customer);

        res.status(201).json({ message: 'Registrasi berhasil', customer: { id: customer.id, name: customer.name, email: customer.email, alamat: customer.alamat } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== CUSTOMERS ==========
app.get('/api/customers', authenticateToken, requireDB, async (req, res) => {
    try { res.json(await db.collection('customers').find({}).sort({ id: 1 }).toArray()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/:id', authenticateToken, requireDB, async (req, res) => {
    try { const c = await db.collection('customers').findOne({ id: parseInt(req.params.id) }); if (!c) return res.status(404).json({ error: 'Tidak ditemukan' }); res.json(c); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { name, email, alamat, password } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Name dan email wajib diisi' });
        const existing = await db.collection('customers').findOne({ email });
        if (existing) return res.status(400).json({ error: 'Email sudah terdaftar' });

        const doc = { id: nextIds.customers++, name, email, password: password || 'customer123', alamat: alamat || '-' };
        await db.collection('customers').insertOne(doc);
        res.status(201).json({ id: doc.id, name: doc.name, email: doc.email, alamat: doc.alamat });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/customers/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const updates = { name: req.body.name, email: req.body.email, alamat: req.body.alamat };
        if (req.body.password) updates.password = req.body.password;
        const r = await db.collection('customers').updateOne({ id: parseInt(req.params.id) }, { $set: updates });
        if (r.matchedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' });
        res.json({ message: 'Updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/customers/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try { const r = await db.collection('customers').deleteOne({ id: parseInt(req.params.id) }); if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' }); res.json({ message: 'Dihapus' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== PRODUCTS ==========
app.get('/api/products', authenticateToken, requireDB, async (req, res) => {
    try { res.json(await db.collection('products').find({}).sort({ id: 1 }).toArray()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/products/:id', authenticateToken, requireDB, async (req, res) => {
    try { const p = await db.collection('products').findOne({ id: parseInt(req.params.id) }); if (!p) return res.status(404).json({ error: 'Tidak ditemukan' }); res.json(p); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/products', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { name, brand, harga, stok, gambar, deskripsi } = req.body;
        const doc = { id: nextIds.products++, name, brand, harga: parseInt(harga), stok: parseInt(stok), gambar: gambar || '', deskripsi: deskripsi || '' };
        await db.collection('products').insertOne(doc);
        res.status(201).json(doc);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/products/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const set = { name: req.body.name, brand: req.body.brand, harga: parseInt(req.body.harga), stok: parseInt(req.body.stok), deskripsi: req.body.deskripsi || '' };
        if (req.body.gambar !== undefined) set.gambar = req.body.gambar;
        const r = await db.collection('products').updateOne({ id: parseInt(req.params.id) }, { $set: set });
        if (r.matchedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' });
        res.json({ message: 'Updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/products/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try { const r = await db.collection('products').deleteOne({ id: parseInt(req.params.id) }); if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' }); res.json({ message: 'Dihapus' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== STOK MASUK ==========
app.get('/api/stok-masuk', authenticateToken, requireDB, async (req, res) => {
    try {
        const data = await db.collection('stok_masuk').find({}).sort({ id: -1 }).toArray();
        const products = await db.collection('products').find({}).toArray();
        res.json(data.map(s => ({ ...s, product_name: products.find(p => p.id === s.product_id)?.name || 'Dihapus' })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/stok-masuk', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { product_id, jumlah, keterangan } = req.body;
        if (!await db.collection('products').findOne({ id: parseInt(product_id) })) return res.status(404).json({ error: 'Produk tidak ditemukan' });
        const addStok = parseInt(jumlah);
        if (addStok <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });

        await db.collection('products').updateOne({ id: parseInt(product_id) }, { $inc: { stok: addStok } });
        const doc = { id: nextIds.stok_masuk++, product_id: parseInt(product_id), jumlah: addStok, keterangan: keterangan || '', tanggal: new Date().toISOString().split('T')[0] };
        await db.collection('stok_masuk').insertOne(doc);
        res.status(201).json(doc);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/stok-masuk/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const stokId = parseInt(req.params.id);
        const { product_id, jumlah, keterangan } = req.body;
        const old = await db.collection('stok_masuk').findOne({ id: stokId });
        if (!old) return res.status(404).json({ error: 'Riwayat tidak ditemukan' });

        const newJumlah = parseInt(jumlah);
        const newProductId = parseInt(product_id);
        if (newJumlah <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });

        const selisih = newJumlah - old.jumlah;
        if (newProductId === old.product_id) {
            if (selisih < 0) {
                const produk = await db.collection('products').findOne({ id: newProductId });
                if (produk.stok + selisih < 0) return res.status(400).json({ error: 'Tidak bisa dikurangi melebihi stok saat ini (' + produk.stok + ')' });
            }
            await db.collection('products').updateOne({ id: newProductId }, { $inc: { stok: selisih } });
        } else {
            const produkLama = await db.collection('products').findOne({ id: old.product_id });
            if (produkLama.stok - old.jumlah < 0) return res.status(400).json({ error: 'Stok produk lama akan minus' });
            await db.collection('products').updateOne({ id: old.product_id }, { $inc: { stok: -old.jumlah } });
            await db.collection('products').updateOne({ id: newProductId }, { $inc: { stok: newJumlah } });
        }

        await db.collection('stok_masuk').updateOne({ id: stokId }, { $set: { product_id: newProductId, jumlah: newJumlah, keterangan: keterangan || '' } });
        res.json({ message: 'Riwayat diupdate, stok produk sudah disesuaikan' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/stok-masuk/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try { const r = await db.collection('stok_masuk').deleteOne({ id: parseInt(req.params.id) }); if (r.deletedCount === 0) return res.status(404).json({ error: 'Riwayat tidak ditemukan' }); res.json({ message: 'Riwayat dihapus' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stok-kurang', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { product_id, jumlah, keterangan } = req.body;
        const produk = await db.collection('products').findOne({ id: parseInt(product_id) });
        if (!produk) return res.status(404).json({ error: 'Produk tidak ditemukan' });
        const kurangStok = parseInt(jumlah);
        if (kurangStok <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });
        if (produk.stok < kurangStok) return res.status(400).json({ error: 'Stok tidak cukup! Saat ini hanya ' + produk.stok });

        await db.collection('products').updateOne({ id: parseInt(product_id) }, { $inc: { stok: -kurangStok } });
        const doc = { id: nextIds.stok_masuk++, product_id: parseInt(product_id), jumlah: kurangStok, keterangan: (keterangan || '') + ' [KURANG]', tanggal: new Date().toISOString().split('T')[0] };
        await db.collection('stok_masuk').insertOne(doc);
        res.status(201).json(doc);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== ORDERS ==========
app.get('/api/orders', authenticateToken, requireDB, async (req, res) => {
    try {
        let query = {};
        if (req.user.role !== 'admin') {
            const cust = await db.collection('customers').findOne({ email: req.user.email });
            if (!cust) return res.json([]);
            query = { customer_id: cust.id };
        }
        const orders = await db.collection('orders').find(query).sort({ id: -1 }).toArray();
        const details = await db.collection('order_details').find({}).toArray();
        const customers = await db.collection('customers').find({}).toArray();
        const products = await db.collection('products').find({}).toArray();
        const payments = await db.collection('payments').find({}).toArray();
        const enriched = orders.map(o => {
            const cust = customers.find(c => c.id === o.customer_id);
            const items = details.filter(d => d.order_id === o.id).map(d => {
                const prod = products.find(p => p.id === d.product_id);
                return { product_id: d.product_id, product_name: prod?.name || 'Dihapus', gambar: prod?.gambar || '', quantity: d.jumlah, price: prod?.harga || 0, subtotal: (prod?.harga || 0) * d.jumlah };
            });
            const payment = payments.find(p => p.order_id === o.id);
            return { ...o, customer_name: cust?.name || o.customer_name || 'Unknown', items, total: items.reduce((s, i) => s + i.subtotal, 0), payment: payment || null };
        });
        res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/user', authenticateToken, requireDB, async (req, res) => {
    try {
        const { items, customer_name, customer_alamat, metode_pembayaran } = req.body;
        if (!items || items.length === 0) return res.status(400).json({ error: 'Keranjang kosong' });
        if (!['Transfer', 'QRIS'].includes(metode_pembayaran)) return res.status(400).json({ error: 'Metode pembayaran tidak valid' });
        
        const products = await db.collection('products').find({}).toArray();
        for (const item of items) {
            const prod = products.find(p => p.id === parseInt(item.product_id));
            if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });
            if (prod.stok < parseInt(item.quantity)) return res.status(400).json({ error: 'Stok tidak cukup' });
        }
        for (const item of items) {
            await db.collection('products').updateOne({ id: parseInt(item.product_id) }, { $inc: { stok: -parseInt(item.quantity) } });
        }
        
        let customerId = null;
        const cust = await db.collection('customers').findOne({ email: req.user.email });
        if (!cust) {
            customerId = nextIds.customers++;
            await db.collection('customers').insertOne({ id: customerId, name: customer_name || 'Pembeli', email: req.user.email, alamat: customer_alamat || '-' });
        } else {
            customerId = cust.id;
            await db.collection('customers').updateOne({ id: customerId }, { $set: { name: customer_name || cust.name, alamat: customer_alamat || cust.alamat } });
        }
        
        const orderId = nextIds.orders++;
        const today = new Date().toISOString().split('T')[0];
        await db.collection('orders').insertOne({ id: orderId, customer_id: customerId, customer_name: customer_name || 'Pembeli', order_date: today, metode_pembayaran });
        for (const item of items) {
            await db.collection('order_details').insertOne({ order_id: orderId, product_id: parseInt(item.product_id), jumlah: parseInt(item.quantity) });
        }
        const payId = nextIds.payments++;
        await db.collection('payments').insertOne({ id: payId, order_id: orderId, metode: metode_pembayaran, pembayaran: 'Pending', tanggal_bayar: null });
        res.status(201).json({ message: 'Order berhasil!', order_id: orderId, metode: metode_pembayaran, status_bayar: 'Pending' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { customer_id, order_date, items } = req.body;
        if (!items || items.length === 0) return res.status(400).json({ error: 'Item kosong' });
        const products = await db.collection('products').find({}).toArray();
        for (const item of items) {
            const prod = products.find(p => p.id === parseInt(item.product_id));
            if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });
            if (prod.stok < parseInt(item.quantity)) return res.status(400).json({ error: 'Stok tidak cukup' });
        }
        for (const item of items) {
            await db.collection('products').updateOne({ id: parseInt(item.product_id) }, { $inc: { stok: -parseInt(item.quantity) } });
        }
        const orderId = nextIds.orders++;
        await db.collection('orders').insertOne({ id: orderId, customer_id: parseInt(customer_id), order_date, metode_pembayaran: 'Manual' });
        for (const item of items) {
            await db.collection('order_details').insertOne({ order_id: orderId, product_id: parseInt(item.product_id), jumlah: parseInt(item.quantity) });
        }
        res.status(201).json({ message: 'Order berhasil', order_id: orderId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/orders/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const oid = parseInt(req.params.id);
        const details = await db.collection('order_details').find({ order_id: oid }).toArray();
        for (const d of details) { await db.collection('products').updateOne({ id: d.product_id }, { $inc: { stok: d.jumlah } }); }
        await db.collection('order_details').deleteMany({ order_id: oid });
        await db.collection('payments').deleteMany({ order_id: oid });
        const r = await db.collection('orders').deleteOne({ id: oid });
        if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' });
        res.json({ message: 'Dihapus, stok dikembalikan' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== PAYMENTS ==========
app.get('/api/payments', authenticateToken, requireDB, async (req, res) => {
    try {
        const payments = await db.collection('payments').find({}).sort({ id: -1 }).toArray();
        const orders = await db.collection('orders').find({}).toArray();
        const details = await db.collection('order_details').find({}).toArray();
        const products = await db.collection('products').find({}).toArray();
        return res.json(payments.map(p => {
            const order = orders.find(o => o.id === p.order_id);
            let total = 0;
            if (order) {
                const oDetails = details.filter(d => d.order_id === order.id);
                oDetails.forEach(d => { const prod = products.find(pr => pr.id === d.product_id); total += (prod?.harga || 0) * d.jumlah; });
            }
            return { ...p, customer_name: order?.customer_name || '-', total };
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/payments/:id/konfirmasi', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const payId = parseInt(req.params.id);
        const payment = await db.collection('payments').findOne({ id: payId });
        if (!payment) return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
        if (payment.pembayaran === 'Lunas') return res.status(400).json({ error: 'Sudah Lunas' });
        const today = new Date().toISOString().split('T')[0];
        await db.collection('payments').updateOne({ id: payId }, { $set: { pembayaran: 'Lunas', tanggal_bayar: today } });
        res.json({ message: 'Pembayaran dikonfirmasi Lunas' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/payments/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try { const r = await db.collection('payments').deleteOne({ id: parseInt(req.params.id) }); if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' }); res.json({ message: 'Dihapus' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== STATS ==========
app.get('/api/stats', authenticateToken, requireDB, async (req, res) => {
    try {
        const totalCustomers = await db.collection('customers').countDocuments();
        const totalProducts = await db.collection('products').countDocuments();
        const totalOrders = await db.collection('orders').countDocuments();
        const payments = await db.collection('payments').find({}).toArray();
        const totalLunas = payments.filter(p => p.pembayaran === 'Lunas').length;
        const totalPending = payments.filter(p => p.pembayaran === 'Pending').length;
        const lunasIds = payments.filter(p => p.pembayaran === 'Lunas').map(p => p.order_id);
        const orders = await db.collection('orders').find({}).toArray();
        const details = await db.collection('order_details').find({}).toArray();
        const products = await db.collection('products').find({}).toArray();
        let totalPendapatan = 0;
        orders.filter(o => lunasIds.includes(o.id)).forEach(o => {
            details.filter(d => d.order_id === o.id).forEach(d => {
                const prod = products.find(p => p.id === d.product_id);
                totalPendapatan += (prod?.harga || 0) * d.jumlah;
            });
        });
        const totalStok = products.reduce((s, p) => s + (p.stok || 0), 0);
        res.json({ totalCustomers, totalProducts, totalOrders, totalLunas, totalPending, totalPendapatan, totalStok });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
//  JALANKAN SERVER (WAJIB ADA UNTUK VERCEL)
// ==========================================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server berjalan di port ${PORT}`);
    });
}

module.exports = app;