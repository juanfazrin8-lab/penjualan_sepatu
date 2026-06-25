const express = require('express');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const cors = require('cors');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_super_aman_sepatu_2024';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
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
//  KONEKSI DB — WAJIB SELESAI DULU
// ==========================================
async function connectDB() {
    console.log('🔄 Menghubungkan ke MongoDB...');
    console.log('   URI:', uri);
    console.log('   DB:', dbName);

    try {
        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 10000, // 10 detik timeout
            connectTimeoutMS: 10000
        });
        await client.connect();
        db = client.db(dbName);

        // Pastikan koneksi benar-benar hidup dengan perintah sederhana
        await db.command({ ping: 1 });

        console.log('✅ Terhubung ke MongoDB — Database:', dbName);

        const cols = await db.listCollections().toArray();
        console.log('📚 Koleksi yang ada:', cols.map(c => c.name).join(', ') || '(belum ada)');

        // Inisialisasi nextIds dari data yang sudah ada
        for (const col of ['customers', 'products', 'orders', 'payments', 'stok_masuk']) {
            try {
                const max = await db.collection(col).find({}).sort({ id: -1 }).limit(1).toArray();
                if (max.length > 0) {
                    nextIds[col] = max[0].id + 1;
                    console.log(`   🔢 ${col}: ID selanjutnya = ${nextIds[col]}`);
                }
            } catch (e) {
                console.log(`   ⚠️ Gagal baca ${col}: ${e.message}`);
            }
        }

        // Buat admin default kalau belum ada
        const adminExists = await db.collection('users').findOne({ email: 'admin@sepatu.com' });
        if (!adminExists) {
            await db.collection('users').insertOne({
                name: 'Administrator',
                email: 'admin@sepatu.com',
                password: 'admin123',
                role: 'admin'
            });
            console.log('🔐 Default Admin dibuat (admin@sepatu.com / admin123)');
        } else {
            console.log('🔐 Admin sudah ada');
        }

        return true; // ← BERHASIL
    } catch (err) {
        console.error('');
        console.error('╔══════════════════════════════════════════════╗');
        console.error('║  ❌ GAGAL KONEKSI MONGODB                     ║');
        console.error('╠══════════════════════════════════════════════╣');
        console.error('║  Error:', err.message);
        console.error('║                                              ║');
        console.error('║  Pastikan:                                   ║');
        console.error('║  1. MongoDB sudah berjalan                   ║');
        console.error('║     (lokal: "mongod" di terminal)            ║');
        console.error('║  2. Atau gunakan MongoDB Atlas               ║');
        console.error('║  3. Cek file .env — MONGODB_URI benar?       ║');
        console.error('╚══════════════════════════════════════════════╝');
        console.error('');
        return false; // ← GAGAL
    }
}

// ==========================================
//  JALANKAN SERVER — TUNGGU DB DULU!
// ==========================================
async function startServer() {
    const dbConnected = await connectDB();

    if (!dbConnected) {
        console.log('⚠️  Server tetap jalan tapi SEMUA fitur DB TIDAK AKAN BEKERJA!');
        console.log('⚠️  Perbaiki koneksi MongoDB lalu restart server.\n');
    }

    // ========== PING ==========
    app.get('/api/ping', (req, res) => {
        res.json({
            status: db ? 'OK' : 'NO_DB',
            db: db ? dbName : 'null',
            time: new Date().toISOString()
        });
    });

    // ========== INFO BANK ==========
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

    // Cek DB siap atau tidak (dipakai di semua endpoint yang butuh DB)
    const requireDB = (req, res, next) => {
        if (!db) {
            return res.status(503).json({ error: 'Database belum terhubung. Cek koneksi MongoDB.' });
        }
        next();
    };

    // ========== AUTH ==========
    app.post('/api/login', requireDB, async (req, res) => {
        try {
            const { email, password } = req.body;
            console.log('🔑 Login attempt:', email);

            let user = await db.collection('users').findOne({ email, password });
            if (!user) {
                user = await db.collection('customers').findOne({ email, password });
            }

            if (!user) {
                console.log('   ❌ Login gagal — email/password salah');
                return res.status(401).json({ error: 'Email atau password salah' });
            }

            const token = jwt.sign({
                id: user.id || user._id,
                email: user.email,
                role: user.role || 'customer'
            }, JWT_SECRET, { expiresIn: '24h' });

            console.log('   ✅ Login berhasil — role:', user.role || 'customer');
            res.json({
                token,
                user: {
                    name: user.name,
                    email: user.email,
                    role: user.role || 'customer'
                }
            });
        } catch (err) {
            console.error('   ❌ Error login:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ========== REGISTER — FIX: requireDB + LOG DETAIL ==========
    app.post('/api/register', requireDB, async (req, res) => {
        try {
            const { name, email, password, alamat } = req.body;
            console.log('📝 Register attempt:', { name, email, alamat: alamat || '-' });

            if (!name || !email || !password) {
                console.log('   ❌ Gagal — field wajib kosong');
                return res.status(400).json({ error: 'Semua field wajib diisi' });
            }

            // Cek duplikat di customers
            const existing = await db.collection('customers').findOne({ email });
            if (existing) {
                console.log('   ❌ Gagal — email sudah terdaftar (customer id:', existing.id, ')');
                return res.status(400).json({ error: 'Email sudah terdaftar' });
            }

            // Cek duplikat di users (jangan sampai email sama dengan admin)
            const existingUser = await db.collection('users').findOne({ email });
            if (existingUser) {
                console.log('   ❌ Gagal — email sudah dipakai admin');
                return res.status(400).json({ error: 'Email sudah terdaftar' });
            }

            const customerId = nextIds.customers++;
            const customer = {
                id: customerId,
                name,
                email,
                password,
                alamat: alamat || '-'
            };

            console.log('   💾 Menyimpan ke collection "customers":', JSON.stringify(customer));

            const result = await db.collection('customers').insertOne(customer);

            console.log('   ✅ Berhasil disimpan! _id:', result.insertedId);

            // VERIFIKASI: baca kembali dari DB
            const verify = await db.collection('customers').findOne({ id: customerId });
            if (verify) {
                console.log('   ✅ Verifikasi OK — data ada di database');
            } else {
                console.log('   ⚠️ Verifikasi GAGAL — data tidak ditemukan setelah insert!');
            }

            res.status(201).json({
                message: 'Registrasi berhasil',
                customer: { id: customer.id, name: customer.name, email: customer.email, alamat: customer.alamat }
            });
        } catch (err) {
            console.error('   ❌ Error register:', err.message);
            console.error('   Stack:', err.stack);
            res.status(500).json({ error: err.message });
        }
    });

    // ========== CUSTOMERS ==========
    app.get('/api/customers', authenticateToken, requireDB, async (req, res) => {
        try {
            const data = await db.collection('customers').find({}).sort({ id: 1 }).toArray();
            console.log('📋 GET /api/customers — ditemukan:', data.length, 'customer');
            res.json(data);
        } catch (err) {
            console.error('❌ Error GET customers:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/customers/:id', authenticateToken, requireDB, async (req, res) => {
        try {
            const c = await db.collection('customers').findOne({ id: parseInt(req.params.id) });
            if (!c) return res.status(404).json({ error: 'Tidak ditemukan' });
            res.json(c);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ========== ADMIN TAMBAH CUSTOMER — FIX: requireDB + LOG + password ==========
    app.post('/api/customers', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
        try {
            const { name, email, alamat, password } = req.body;
            console.log('👤 Admin tambah customer:', { name, email, alamat: alamat || '-' });

            if (!name || !email) {
                console.log('   ❌ Gagal — name/email kosong');
                return res.status(400).json({ error: 'Name dan email wajib diisi' });
            }

            // Cek duplikat
            const existing = await db.collection('customers').findOne({ email });
            if (existing) {
                console.log('   ❌ Gagal — email sudah ada (id:', existing.id, ')');
                return res.status(400).json({ error: 'Email sudah terdaftar' });
            }

            const customerId = nextIds.customers++;
            const doc = {
                id: customerId,
                name,
                email,
                password: password || 'customer123', // default password kalau admin tidak isi
                alamat: alamat || '-'
            };

            console.log('   💾 Menyimpan:', JSON.stringify(doc));

            const result = await db.collection('customers').insertOne(doc);

            console.log('   ✅ Berhasil! _id:', result.insertedId);

            // VERIFIKASI
            const verify = await db.collection('customers').findOne({ id: customerId });
            if (verify) {
                console.log('   ✅ Verifikasi OK');
            } else {
                console.log('   ⚠️ Verifikasi GAGAL!');
            }

            res.status(201).json({ id: doc.id, name: doc.name, email: doc.email, alamat: doc.alamat });
        } catch (err) {
            console.error('   ❌ Error tambah customer:', err.message);
            console.error('   Stack:', err.stack);
            res.status(500).json({ error: err.message });
        }
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
        try {
            const r = await db.collection('customers').deleteOne({ id: parseInt(req.params.id) });
            if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' });
            res.json({ message: 'Dihapus' });
        } catch (err) { res.status(500).json({ error: err.message }); }
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
        try {
            const r = await db.collection('products').deleteOne({ id: parseInt(req.params.id) });
            if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' });
            res.json({ message: 'Dihapus' });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

 // ========== STOK MASUK — GET ==========
app.get('/api/stok-masuk', authenticateToken, requireDB, async (req, res) => {
    try {
        const data = await db.collection('stok_masuk').find({}).sort({ id: -1 }).toArray();
        const products = await db.collection('products').find({}).toArray();
        res.json(data.map(s => ({
            ...s,
            product_name: products.find(p => p.id === s.product_id)?.name || 'Dihapus'
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== STOK MASUK — POST (TAMBAH STOK) ==========
app.post('/api/stok-masuk', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { product_id, jumlah, keterangan } = req.body;
        if (!await db.collection('products').findOne({ id: parseInt(product_id) })) {
            return res.status(404).json({ error: 'Produk tidak ditemukan' });
        }
        const addStok = parseInt(jumlah);
        if (addStok <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });

        await db.collection('products').updateOne(
            { id: parseInt(product_id) },
            { $inc: { stok: addStok } }
        );
        const doc = {
            id: nextIds.stok_masuk++,
            product_id: parseInt(product_id),
            jumlah: addStok,
            keterangan: keterangan || '',
            tanggal: new Date().toISOString().split('T')[0]
        };
        await db.collection('stok_masuk').insertOne(doc);
        res.status(201).json(doc);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== STOK MASUK — PUT (EDIT RIWAYAT, sesuaikan stok produk) ==========
app.put('/api/stok-masuk/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const stokId = parseInt(req.params.id);
        const { product_id, jumlah, keterangan } = req.body;

        const old = await db.collection('stok_masuk').findOne({ id: stokId });
        if (!old) return res.status(404).json({ error: 'Riwayat tidak ditemukan' });

        const newJumlah = parseInt(jumlah);
        const newProductId = parseInt(product_id);

        if (newJumlah <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });

        // Hitung selisih: stok produk akan berubah sebanyak (baru - lama)
        const selisih = newJumlah - old.jumlah;

        // Jika produk sama, cek agar stok tidak minus
        if (newProductId === old.product_id && selisih < 0) {
            const produk = await db.collection('products').findOne({ id: newProductId });
            if (produk.stok + selisih < 0) {
                return res.status(400).json({ error: 'Tidak bisa dikurangi melebihi stok saat ini (' + produk.stok + ')' });
            }
        }

        // Jika produk berbeda, cek produk lama dan baru
        if (newProductId !== old.product_id) {
            // Kembalikan stok produk lama (dikurangi jumlah lama)
            const produkLama = await db.collection('products').findOne({ id: old.product_id });
            if (produkLama.stok - old.jumlah < 0) {
                return res.status(400).json({ error: 'Tidak bisa mengubah produk: stok produk lama (' + produkLama.name + ') akan minus' });
            }
            // Tambah stok produk baru (ditambah jumlah baru, selalu aman)
            // Keduanya aman untuk produk baru karena tambah positif
        }

        // Terapkan ke produk
        if (newProductId === old.product_id) {
            // Produk sama: tambahkan selisih
            await db.collection('products').updateOne(
                { id: newProductId },
                { $inc: { stok: selisih } }
            );
        } else {
            // Produk beda: kurangi dari lama, tambah ke baru
            await db.collection('products').updateOne(
                { id: old.product_id },
                { $inc: { stok: -old.jumlah } }
            );
            await db.collection('products').updateOne(
                { id: newProductId },
                { $inc: { stok: newJumlah } }
            );
        }

        // Update record riwayat
        await db.collection('stok_masuk').updateOne(
            { id: stokId },
            { $set: { product_id: newProductId, jumlah: newJumlah, keterangan: keterangan || '' } }
        );

        res.json({ message: 'Riwayat diupdate, stok produk sudah disesuaikan' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== STOK MASUK — DELETE (HANYA HAPUS RIWAYAT) ==========
app.delete('/api/stok-masuk/:id', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const stokId = parseInt(req.params.id);
        const r = await db.collection('stok_masuk').deleteOne({ id: stokId });
        if (r.deletedCount === 0) return res.status(404).json({ error: 'Riwayat tidak ditemukan' });
        res.json({ message: 'Riwayat dihapus' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== KURANG STOK — POST (ENDPOINT TERPISAH) ==========
app.post('/api/stok-kurang', authenticateToken, authorizeAdmin, requireDB, async (req, res) => {
    try {
        const { product_id, jumlah, keterangan } = req.body;
        const produk = await db.collection('products').findOne({ id: parseInt(product_id) });
        if (!produk) return res.status(404).json({ error: 'Produk tidak ditemukan' });

        const kurangStok = parseInt(jumlah);
        if (kurangStok <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });

        if (produk.stok < kurangStok) {
            return res.status(400).json({ error: 'Stok tidak cukup! Saat ini hanya ' + produk.stok + ', ingin mengurangi ' + kurangStok });
        }

        await db.collection('products').updateOne(
            { id: parseInt(product_id) },
            { $inc: { stok: -kurangStok } }
        );
        const doc = {
            id: nextIds.stok_masuk++,
            product_id: parseInt(product_id),
            jumlah: kurangStok,
            keterangan: (keterangan || '') + ' [KURANG]',
            tanggal: new Date().toISOString().split('T')[0]
        };
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
            const customer_email = req.user.email;
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
                await db.collection('customers').insertOne({ id: customerId, name: customer_name || 'Pembeli', email: customer_email, alamat: customer_alamat || '-' });
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
            await db.collection('orders').insertOne({ id: orderId, customer_id: parseInt(customer_id), order_date: order_date, metode_pembayaran: 'Manual' });
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
        try {
            const r = await db.collection('payments').deleteOne({ id: parseInt(req.params.id) });
            if (r.deletedCount === 0) return res.status(404).json({ error: 'Tidak ditemukan' });
            res.json({ message: 'Dihapus' });
        } catch (err) { res.status(500).json({ error: err.message }); }
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

    // ========== JALANKAN SERVER ==========
    app.listen(PORT, () => {
        console.log('');
        console.log('========================================');
        console.log('  Server JALAN di http://localhost:' + PORT);
        console.log('  DB Status:', db ? '✅ TERHUBUNG' : '❌ TIDAK TERHUBUNG');
        console.log('========================================');
        console.log('');
    });
}

// ==========================================
//  START!
// ==========================================
startServer().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

process.on('SIGINT', async () => {
    if (client) await client.close();
    process.exit(0);
});