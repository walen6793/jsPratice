const { json } = require('body-parser')
const express = require('express')
const app = express()
const mysql = require('mysql2/promise')

const { connect } = require('http2')
const bcrypt = require('bcrypt')
const { start } = require('repl')
const dotenv = require('dotenv').config();
const cors = require('cors')
const jwt = require('jsonwebtoken')
const moment = require('moment')
const xlsx = require('xlsx');
const { Server } = require("socket.io");
const cron = require('node-cron');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat); 

const ExcelJS = require('exceljs');
const PdfTable = require('pdfkit-table');



const checkAPI_key = require('./middleware/checkAPI_key')
const checkAuth = require('./middleware/checkAuth')
const checkAdminAuth = require('./middleware/checkAdminAuth')
const checkRole = require('./middleware/checkRole')
const ValidationError = require('./validateErr/AppError')
const {createMeeting,deleteZoomMeeting} = require('./services/zoomService')
const { exitCode } = require('process')
const { count, time, error } = require('console')
const { platform } = require('os')
const port = process.env.PORT || 8000
const db = require('./config/db')
const multer = require('multer')
const path = require('path')
const sharp = require('sharp')
const fs = require('fs')
const http = require('http')

const corsOptions = {
    origin: '*', // เปลี่ยนเป็น URL ของเว็บ Frontend คุณ (เช่น React/Vue)
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // อนุญาต Method อะไรบ้าง
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'], // Header ที่ยอมให้ส่งมา
    credentials: true // ถ้ามีการส่ง Cookie หรือ Session ให้เปิดเป็น true
};

app.use(cors(corsOptions))
app.use(express.json()) // อ่านเป็นแบบ JSON
app.use(express.static('public'));
app.use(checkAPI_key)
const server = http.createServer(app);

const formatThaiDate = (dateInput, includeTime = false) => {
    if (!dateInput) return "ไม่ระบุวันที่";
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return "วันที่ไม่ถูกต้อง"; 

    const monthNames = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];
    
    const day = date.getDate();
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear() + 543;
    
    let result = `${day} ${month} ${year}`;

    if (includeTime) {
        // 🌟 แก้ตรงนี้: บังคับให้ดึงเวลาแบบ Asia/Bangkok
        const timeString = date.toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Bangkok' // <--- บังคับเป็นเวลาไทย
        });
        result += ` (${timeString} น.)`;
    }
    
    return result;
};

const io = new Server(server, {
    cors: {
        origin: "*", // อนุญาตให้หน้าเว็บ (Frontend) เชื่อมต่อเข้ามาได้
        methods: ["GET", "POST"]
    }
});


// 🌟 3. สร้างลอจิก "นายหน้าจับคู่ (Signaling)"
io.on('connection', (socket) => {
    console.log('⚡ มีอุปกรณ์เชื่อมต่อเข้ามาใหม่: ', socket.id);

    // เมื่อมีคนขอเข้าห้อง (ญาติ หรือ ตู้เรือนจำ)
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId); // จับยัดเข้าห้อง
        console.log(`👤 User ${userId} เข้าห้อง ${roomId}`);

        // ตะโกนบอกคนอื่นๆ ในห้องว่า "เฮ้ย มีคนมาใหม่นะ!" (เพื่อเตรียมเชื่อมกล้อง)
        socket.to(roomId).emit('user-connected', userId);

        // จัดการลอจิกตอนส่งข้อมูล WebRTC (SDP / ICE Candidate) หากัน
        socket.on('offer', (offer, room) => socket.to(room).emit('offer', offer));
        socket.on('answer', (answer, room) => socket.to(room).emit('answer', answer));
        socket.on('ice-candidate', (candidate, room) => socket.to(room).emit('ice-candidate', candidate));



        // 🌟 เพิ่ม Event สำหรับตอนที่ User กดปุ่ม "วางสาย"
    socket.on('leave-room', (roomId, userId) => {
        socket.leave(roomId); // จับเตะออกจากห้องของ Socket.io
        console.log(`👋 User ${userId} กดปุ่มวางสายและออกจากห้อง ${roomId}`);
        
        // ตะโกนบอกคนที่เหลือในห้องว่า "เขาไปแล้วนะ!"
        socket.to(roomId).emit('user-disconnected', userId);
    });
        
        // เมื่อมีคนกดวางสาย หรือเน็ตหลุด
        socket.on('disconnect', () => {
            console.log(`❌ User ${userId} ออกจากห้อง ${roomId}`);
            socket.to(roomId).emit('user-disconnected', userId);
        });
    });
});


server.listen(port, async () => {
    try {
        // 1. เช็คการเชื่อมต่อ Database ก่อน
        const connection = await db.getConnection();
        connection.release();
        console.log(`✅ เชื่อมต่อฐานข้อมูลสำเร็จ!`);
        
        // 2. แจ้งสถานะเซิร์ฟเวอร์
        console.log(`🚀 Server และ WebRTC Signaling รันอยู่ที่พอร์ต ${port}`);
    } catch (error) {
        console.error('❌ Error connecting to the database : ', error.message);
        process.exit(1); // สั่งปิดโปรแกรมถ้า DB พัง
    }
});

const storage = multer.memoryStorage();
//กรองไฟล์
const fileFilter = (req,file,cb) => {
    //เช็คว่า mimetype ของไฟล์ขึ้นต้นด้วย 'image/หรือไม่ 
    if (file.mimetype.startsWith('image/')){
        cb(null,true);
    }else{
        cb(new ValidationError('กรุณาอัปโหลดไฟล์รูปภาพเท่านั้น',400),false);
    }


};


const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limit: { fileSize: 10 * 1024 * 1024 }//ล็อคขนาดไฟล์
});

const excelUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        // อนุญาตเฉพาะไฟล์ .xlsx, .xls และ .csv
        const allowedMimeTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'text/csv' // .csv
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true); // ปล่อยผ่าน
        } else {
            cb(new Error('กรุณาอัปโหลดไฟล์ Excel (.xlsx, .xls) หรือ CSV เท่านั้น')); // เตะออกถ้าไม่ใช่
        }
    }
});

cron.schedule('0 * * * *', async () => {
    console.log('⏰ กำลังรันระบบแจ้งเตือนคิวเยี่ยมประจำวัน...');
    try {
        // หาคิวของ "วันพรุ่งนี้" ที่สถานะเป็น COMPLETED
        const sqlFind = `
            SELECT 
                vb.relative_user_id AS userId,
                vs.visit_date,
                vs.starts_at,
                CONCAT(i.firstname, ' ', i.lastname) AS inmate_name
            FROM visit_booking vb
            JOIN visit_slot vs ON vb.slot_id = vs.id
            JOIN inmate i ON vb.inmate_id = i.id
            WHERE DATE(vs.visit_date) = CURDATE() + INTERVAL 1 DAY
            AND vb.status = 'PENDING'
        `;

        const [bookings] = await db.query(sqlFind);

        if (bookings.length > 0) {
            // เตรียมข้อมูลสำหรับ Insert หลายๆ แถวพร้อมกัน
            const values = bookings.map(b => [
                b.userId,
                '📅 แจ้งเตือน: พรุ่งนี้มีคิวเข้าเยี่ยม',
                `คุณมีนัดเข้าเยี่ยมคุณ ${b.inmate_name} ในวันพรุ่งนี้ เวลา ${b.starts_at} น. กรุณาเข้าแอปเพื่อเตรียมตัวก่อนเวลา 15 นาทีครับ`,
                0
            ]);
            

            const sqlInsert = `INSERT INTO notifications (user_id, title, message, is_read) VALUES ?`;
            await db.query(sqlInsert, [values]);
            
            console.log(`✅ ส่งการแจ้งเตือนสำเร็จ ${bookings.length} รายการ`);
        }
    } catch (error) {
        console.error('❌ Cron Job Notification Error:', error);
    }
}, {
    timezone: "Asia/Bangkok"
});


// 🔔 1. ดึงการแจ้งเตือน (ดึง userId จาก Token โดยตรง)
app.get('/api/notifications',checkAPI_key, checkAuth, async (req, res) => {
    try {
        // ดึง userId ที่ระบุตัวตนได้จาก Middleware
        const userId = req.user.userId; 

        // ดึง 20 รายการล่าสุด
        const [rows] = await db.query(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
            [userId]
        );

       
        

        // นับจำนวนที่ยังไม่ได้อ่าน
        const [unreadCountResult] = await db.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [userId]
        );
        
        const formattedNotifications = rows.map(noti => ({
            ...noti,
            // เรียกใช้ฟังก์ชัน formatThaiDate ที่เราทำไว้
            // ถ้ายังไม่ได้ก๊อปฟังก์ชันนั้นมา ให้เอาไปวางไว้บนสุดของไฟล์ด้วยนะครับ
            created_at: formatThaiDate(noti.created_at,true) 
        }));

        res.json({
            notifications: formattedNotifications, // ส่งตัวที่ Format แล้วไป
            unreadCount: unreadCountResult[0].count
        });
    } catch (error) {
        console.error("Notification Error:", error);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลแจ้งเตือนได้" });
    }
});


// ✅ 2. อัปเดตเมื่อกดอ่าน (ใส่ checkAuth เพื่อป้องกันการแอบแก้ของคนอื่น)
app.put('/api/notifications/read/:id', checkAPI_key,checkAuth, async (req, res) => {
    try {
        const notiId = req.params.id;
        const userId = req.user.userId;

        // UPDATE โดยเช็ค user_id ด้วย เพื่อความปลอดภัย (เผื่อใครสุ่ม ID แจ้งเตือนมั่วๆ)
        const [result] = await db.query(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', 
            [notiId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "ไม่พบรายการแจ้งเตือนนี้" });
        }

        res.json({ success: true, message: "อ่านเรียบร้อย" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// app.post('/user/claim-inmate', checkAPI_key,checkAuth,upload.fields([
//     {name : 'id_card_image',maxCount:1},
//     {name: 'selfie_image',maxCount:1}

// ]),async(req,res) => {
//     try{
//         const userId = req.user.userId;
//         const {inmate_id, visitor_id_card,} =req.body

//         if (!inmate_id || !visitor_id_card){
//             throw new ValidationError("กรุณาระบุ inmate_id และ visitor_id_card",400);
//         }
//         if (!req.files || !req.files['id_card_image'] || !req.files['selfie_image']){
//             throw new ValidationError("กรุณาอัปโหลดรูปภาพบัตรประชาชนและรูปภาพเซลฟี่",400);
//         }
//         const [inmateRows] = await db.execute(`
//             SELECT inmate_rowID 
//             FROM incarcerations 
//             WHERE inmate_id = ?
//         `, [inmate_id]);
//         if (inmateRows.length === 0) {
//             throw new ValidationError("ไม่พบข้อมูลรหัสผู้ต้องขังนี้ในระบบ กรุณาตรวจสอบรหัสอีกครั้ง", 404);
//         }
//         const internalInmateId = inmateRows[0].inmate_rowID;

        

//         const [rows] = await db.execute(`
//             SELECT ui.id,ui.userId,ui.status,ic.inmate_id AS inmate_number, ui.id_card_image, ui.selfie_image
//             FROM user_inmate_relationship AS ui
//             JOIN incarcerations AS ic ON ui.inmateId = ic.inmate_rowID
//             WHERE ic.inmate_rowID = ? AND ui.visitor_id_card = ?

            
//             `,[internalInmateId,visitor_id_card]);

//         let relationshipId;
//         let isNewRequest = false;
//         let oldImages = null;
//         if (rows.length > 0){
//             const relationship = rows[0];

//             if (relationship.userId !== null && relationship.userId !== userId) {
//                 throw new ValidationError("บัตรประชาชนนี้ถูกใช้งานโดยบัญชีอื่นไปแล้ว กรุณาติดต่อเจ้าหน้าที่", 400);
//             }
//             if (relationship.status === 'APPROVED' || relationship.status === 'PENDING') {
//                 console.log("rela : ",relationship.id)
//                 throw new ValidationError("คุณได้ส่งคำขอไปแล้ว หรือสถานะได้รับการอนุมัติแล้ว ไม่สามารถส่งซ้ำได้", 400);
//             }
//             relationshipId = relationship.id;
//             oldImages = {
//                 id_card: relationship.id_card_image,
//                 selfie: relationship.selfie_image
//             }
//         }else {
//             // 🟡 กรณีที่ 2: "ไม่มีชื่อในระบบ" (นักโทษลืมแจ้ง หรืออยากเพิ่มชื่อใหม่)
//             isNewRequest = true; // เปิด Flag ว่านี่คือการสร้างคำร้องใหม่
//         }
//         const processAndSaveImage = async (fileBuffer, fieldName) => {
//             const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//             const filename = `${fieldName}-${uniqueSuffix}.jpg`;
//             const filepath = path.join(process.cwd(), 'uploads', filename);
//             console.log("🕵️‍♂️ ตำแหน่งไฟล์รูปที่แท้จริงคือ: ", filepath);

//             await sharp(fileBuffer)
//                 .resize({ width: 1000, withoutEnlargement: true })
//                 .jpeg({ quality: 70 })
//                 .toFile(filepath);

//             return filename;
//         };

//         const [idCardFilename, selfieFilename] = await Promise.all([
//             processAndSaveImage(req.files['id_card_image'][0].buffer, 'id_card_image'),
//             processAndSaveImage(req.files['selfie_image'][0].buffer, 'selfie_image')
//         ]);

//        if (!isNewRequest){
//         await db.execute(`
//             UPDATE user_inmate_relationship 
//             SET userId = ?,
//             status = 'PENDING',
//             id_card_image = ?,
//             selfie_image = ?
//             WHERE id = ?
//             `,[userId,idCardFilename,selfieFilename,relationshipId])

//             const deleteOldFile = (filename) => {
//                 if(filename) {
//                     const filePath = path.join(process.cwd(),'uploads',filename);
                    
//                     if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

//                 }
//             }
//             if (oldImages){
//                 deleteOldFile(oldImages.id_card);
//                 deleteOldFile(oldImages.selfie);
//             }
//        }else{
//             const [insertResult] = await db.execute(`
//                 INSERT INTO user_inmate_relationship
//                 (userId, inmateId,visitor_id_card,visitor_firstname,visitor_lastname,status,id_card_image,selfie_image)
//                 VALUES (?,?,?,?,?,'PENDING',?,?)
                
                
                
//                 `,[userId,internalInmateId,visitor_id_card,null,null, idCardFilename, selfieFilename])
//                 relationshipId = insertResult.insertId;

//        }
        
//         res.status(200).json({

//             message : 'ส่งคำขอสำเร็จ! กรุณารอเจ้าหน้าที่ตรวจสอบรูปภาพหลักฐาน',
//             data : {
//                 relationship_id : relationshipId,
//                 status : 'PENDING'
//             }
//         })

        

//     }catch (error){
//         console.error(error)
//         if (error instanceof ValidationError){
//             return res.status(error.statusCode || 400).json({message: error.message})
//         }
//         return res.status(500).json({message: 'Internal Server Error'})
//     }

// });

// GET /admin/users (เรียกดูรายชื่อญาติทั้งหมด หรือค้นหาตามชื่อ/เลขบัตร)
app.get('/admin/users', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'COMMANDER', 'REGISTRAR', 'VISITATION']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { search } = req.query; // รับคำค้นหาจาก URL เช่น ?search=สมชาย

        // ดึงเฉพาะคอลัมน์ที่ปลอดภัย (ไม่ดึง hashed_password)
        let sql = `
            SELECT u.userId, u.id_card, p.prefixes_nameth, u.firstname, u.lastname, u.phone, u.is_active, u.create_time, u.last_active_at 
            FROM user AS u LEFT JOIN prefixes AS p ON u.prefixe_id = p.id_prefixes
        `;
        let params = [];

        // ถ้ามีการส่งคำค้นหามา ให้ค้นหาจากเลขบัตร หรือ ชื่อ หรือ นามสกุล
        if (search) {
            sql += ` WHERE id_card LIKE ? OR firstname LIKE ? OR lastname LIKE ? `;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        sql += ` ORDER BY create_time DESC`;

        const [users] = await connection.execute(sql, params);

        return res.status(200).json({
            message: "ดึงข้อมูลญาติสำเร็จ",
            total: users.length,
            data: users
        });
    } catch (error) {
        console.error("Get Users Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลญาติ" });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /admin/users/:id/status (เปิดการใช้งาน หรือ ระงับบัญชีญาติ)
app.put('/admin/users/:id/status', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const targetUserId = req.params.id; // รับ userId จาก URL
        const { is_active } = req.body; // รับค่า 1 (เปิด) หรือ 0 (ระงับ) จาก Frontend

        // เช็กว่าส่งค่ามาถูกต้องไหม (ต้องเป็น 0 หรือ 1 เท่านั้น)
        if (is_active === undefined || ![0, 1].includes(Number(is_active))) {
            return res.status(400).json({ message: "กรุณาส่งค่า is_active เป็น 0 หรือ 1 เท่านั้น" });
        }

        // เช็กว่ามีญาติคนนี้อยู่จริงไหม
        const [checkUser] = await connection.execute('SELECT userId FROM user WHERE userId = ?', [targetUserId]);
        if (checkUser.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลญาติในระบบ" });
        }

        // อัปเดตสถานะ
        await connection.execute(`UPDATE user SET is_active = ? WHERE userId = ?`, [is_active, targetUserId]);

        const statusMessage = is_active == 1 ? "เปิดใช้งานบัญชี" : "ระงับการใช้งานบัญชี";
        
        return res.status(200).json({ 
            message: `${statusMessage} เรียบร้อยแล้ว` 
        });

    } catch (error) {
        console.error("Update User Status Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะบัญชี" });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /admin/users/:id (แก้ไขข้อมูลส่วนตัวญาติโดยแอดมิน)
app.put('/admin/users/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const targetUserId = req.params.id;
        const { prefix, firstname, lastname, phone } = req.body;

        // เช็กข้อมูลบังคับ (ไม่ให้แก้ id_card ป้องกันข้อมูลหลักเพี้ยน)
        if (!firstname || !lastname || !phone) {
            return res.status(400).json({ message: "กรุณากรอกชื่อ นามสกุล และเบอร์โทรศัพท์ให้ครบถ้วน" });
        }
        const [prefixRows] = await connection.execute(`SELECT id_prefixes, prefixes_nameTh FROM prefixes`);
        const prefixMap ={};
        prefixRows.forEach(item => {
            // ใช้ .trim() เพื่อตัดช่องว่างหน้า-หลัง เผื่อใน DB พิมพ์เว้นวรรคเกิน
            const cleanPrefixName = item.prefixes_nameTh.toString().trim();
            
            // จับคู่ ตัวหนังสือ = ID
            prefixMap[cleanPrefixName] = item.id_prefixes; 
        });

        let finalPrefixId = null;
        if (prefix) {
            finalPrefixId = prefixMap[prefix]; // โยนคำว่า "แดน 1" เข้าไป มันจะคายเลข 1 ออกมา

            // 🚨 เช็คว่า "ถ้าหา ID ไม่เจอ (แปลว่าแอดมินพิมพ์ชื่อแดนผิด หรือไม่มีแดนนี้ในระบบ)"
            if (!finalPrefixId) {
                finalPrefixId = null;
            }
        }

        // เช็กว่ามีญาติคนนี้อยู่จริงไหม
        const [checkUser] = await connection.execute('SELECT userId FROM user WHERE userId = ?', [targetUserId]);
        if (checkUser.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลญาติในระบบ" });
        }
        const [checkPhone_SQL] = await connection.execute('SELECT phone FROM user WHERE phone = ? AND userId != ?;', [phone,targetUserId])
        if (checkPhone_SQL.length > 0){
            throw new ValidationError("เบอร์โทรศัพท์นี้มีผู้ใช้งานแล้ว")
        }

        // อัปเดตข้อมูล
        await connection.execute(`
            UPDATE user 
            SET prefixe_id = ?, firstname = ?, lastname = ?, phone = ?
            WHERE userId = ?
        `, [finalPrefixId || null, firstname, lastname, phone, targetUserId]);

        return res.status(200).json({ message: "แก้ไขข้อมูลส่วนตัวญาติเรียบร้อยแล้ว" });

    } catch (error) {
        console.error("Update User Info Error:", error);
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลญาติ" });
    } finally {
        if (connection) connection.release();
    }
});

// ==========================================
// 📸 API สำหรับญาติส่งคำขอผูกรายชื่อผู้ต้องขัง (พร้อมระบุความสัมพันธ์)
// ==========================================
app.post('/user/claim-inmate', checkAPI_key, checkAuth, upload.fields([
    {name: 'id_card_image', maxCount: 1},
    {name: 'selfie_image', maxCount: 1}
]), async(req,res) => {
    try{
        const userId = req.user.userId;
        const { firstname,lastname, relation } = req.body; // 🌟 เพิ่มการรับค่า relation (ข้อความ)

        // 1. ตรวจสอบข้อมูลเบื้องต้น
        if (!firstname || !lastname){
            throw new ValidationError("กรุณาระบุชื่อ - นามสกุลผู้ต้องขัง", 400);
        }
        if (!relation || typeof relation !== 'string' || relation.trim() === ''){
            throw new ValidationError("กรุณาระบุความสัมพันธ์กับผู้ต้องขัง", 400);
        }
        if (!req.files || !req.files['id_card_image'] || !req.files['selfie_image']){
            throw new ValidationError("กรุณาอัปโหลดรูปภาพบัตรประชาชนและรูปภาพเซลฟี่", 400);
        }

        // 2. 🌟 Map ความสัมพันธ์ (String) เป็น ID (Number)
        const trimmedRelation = relation.trim();
        // แก้ไขชื่อตาราง 'relations_type' และคอลัมน์ให้ตรงกับฐานข้อมูลของคุณ
        const [relationRows] = await db.execute('SELECT id FROM relation_type WHERE type_name_relationship_th = ?', [trimmedRelation]);
        
        if (relationRows.length === 0) {
            throw new ValidationError(`ไม่พบประเภทความสัมพันธ์ '${trimmedRelation}' ในระบบ กรุณาตรวจสอบอีกครั้ง`, 400);
        }
        const finalRelationId = relationRows[0].id; // ได้ ID ตัวเลขแล้ว!

        // 3. ดึงเลขบัตรประชาชนของญาติที่ล็อกอินอยู่
        const [userRows] = await db.execute('SELECT id_card, firstname, lastname FROM user WHERE userId = ?', [userId]);
        const visitor = userRows[0];

        // 4. หารหัสนักโทษในระบบ
        const [inmateRows] = await db.execute(`SELECT id FROM inmate WHERE firstname = ? AND lastname = ?`, [firstname,lastname]);
        if (inmateRows.length === 0) {
            throw new ValidationError("ไม่พบข้อมูลรหัสผู้ต้องขังนี้ในระบบ กรุณาตรวจสอบชื่อนามสกุลอีกครั้ง", 404);
        }
        const internalInmateId = inmateRows[0].id;

        // 5. เช็กว่าเคยส่งคำขอผูกบัญชีกับนักโทษคนนี้ไปหรือยัง?
        const [existingReq] = await db.execute(`
            SELECT id, status 
            FROM user_inmate_relationship 
            WHERE userId = ? AND inmateId = ?
        `, [userId, internalInmateId]);

        if (existingReq.length > 0) {
            const rel = existingReq[0];
            if (rel.status === 'APPROVED' || rel.status === 'PENDING') {
                throw new ValidationError("คุณได้ส่งคำขอไปแล้ว หรือสถานะได้รับการอนุมัติแล้ว ไม่สามารถส่งซ้ำได้", 400);
            }
        }

        // 6. จัดการเซฟรูปภาพ
        const processAndSaveImage = async (fileBuffer, fieldName) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const filename = `${fieldName}-${uniqueSuffix}.jpg`;
            const filepath = path.join(process.cwd(), 'uploads', filename);
            await sharp(fileBuffer).resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 70 }).toFile(filepath);
            return filename;
        };

        const [idCardFilename, selfieFilename] = await Promise.all([
            processAndSaveImage(req.files['id_card_image'][0].buffer, 'id_card_image'),
            processAndSaveImage(req.files['selfie_image'][0].buffer, 'selfie_image')
        ]);

        // 7. บันทึก/อัปเดต ลงฐานข้อมูล (🌟 เพิ่ม relationsType_id)
        let relationshipId;
        if (existingReq.length > 0) {
            // กรณีเคยถูกปฏิเสธ (REJECTED) แล้วส่งใหม่ ให้อัปเดตสถานะกลับเป็น PENDING พร้อมเปลี่ยนความสัมพันธ์ใหม่
            await db.execute(`
                UPDATE user_inmate_relationship 
                SET status = 'PENDING', id_card_image = ?, selfie_image = ?, reject_reason = NULL, relationType_id = ?
                WHERE id = ?
            `, [idCardFilename, selfieFilename, finalRelationId, existingReq[0].id]);
            relationshipId = existingReq[0].id;
        } else {
            // กรณีขอผูกครั้งแรก
            const [insertResult] = await db.execute(`
                INSERT INTO user_inmate_relationship
                (userId, inmateId, visitor_id_card, status, id_card_image, selfie_image, relationType_id)
                VALUES (?, ?, ?, 'PENDING', ?, ?, ?)
            `, [userId, internalInmateId, visitor.id_card, idCardFilename, selfieFilename, finalRelationId]);
            relationshipId = insertResult.insertId;
        }
        
        res.status(200).json({
            message : 'ส่งคำขอสำเร็จ! กรุณารอเจ้าหน้าที่ตรวจสอบรูปภาพหลักฐาน',
            data : { 
                relationship_id : relationshipId, 
                status : 'PENDING',
                relation_name : trimmedRelation // ส่งชื่อความสัมพันธ์กลับไปให้แอปเผื่อเอาไปแสดงผล
            }
        });

    } catch (error){
        console.error("Claim Inmate Error:", error);
        if (error instanceof ValidationError) return res.status(error.statusCode || 400).json({message: error.message});
        return res.status(500).json({message: 'Internal Server Error'});
    }
});
// GET /admin/officers (ดึงรายชื่อเจ้าหน้าที่ทั้งหมด)
app.get('/admin/officers', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        // เลือกมาเฉพาะข้อมูลที่ปลอดภัย (ไม่ดึง password)
        const [officers] = await connection.execute(`
            SELECT id, username, fullname, role, is_active 
            FROM officers 
            ORDER BY id DESC
        `);

        return res.status(200).json({
            message: "ดึงข้อมูลเจ้าหน้าที่สำเร็จ",
            total: officers.length,
            data: officers
        });
    } catch (error) {
        console.error("Get Officers Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลเจ้าหน้าที่" });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/admin/officers/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const officerId = req.params.id;
        const [officer] = await connection.execute(`
            SELECT id, username, fullname, role, is_active 
            FROM officers WHERE id = ?
        `, [officerId]);

        if (officer.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลเจ้าหน้าที่" });
        }

        return res.status(200).json({
            message: "ดึงข้อมูลเจ้าหน้าที่สำเร็จ",
            data: officer[0]
        });
    } catch (error) {
        console.error("Get Officer By ID Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลเจ้าหน้าที่" });
    } finally {
        if (connection) connection.release();
    }
});

app.post('/admin/officers', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN']), async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        const { username, password, fullname, role, is_active} = req.body;
        const allowedRoles = ['REGISTRAR', 'VISITATION', 'COMMANDER', 'SUPER_ADMIN'];
        // 1. เช็กข้อมูลเบื้องต้น
        if (!username || !password || !fullname || !role) {
            return res.status(400).json({ message: "กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน" });
        }

        if (!allowedRoles.includes(role)) {
            return res.status(403).json({ message: "role ของคุณไม่ถูกต้องต้องเป็น !'REGISTRAR', 'VISITATION', 'COMMANDER', 'SUPER_ADMIN'" });
        }
        // 2. เช็กว่า Username นี้มีคนใช้ไปหรือยัง (ห้ามซ้ำ)
        const [existingUser] = await connection.execute('SELECT id FROM officers WHERE username = ?', [username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Username หรือรหัสเจ้าหน้าที่นี้ มีในระบบแล้ว" });
        }

        // 3. ป้องกัน Admin ทั่วไป แอบสร้างบัญชีระดับ Super Admin (สิทธิ์เกินตัว)
        // สมมติว่าคนล็อกอินอยู่คือ req.user (ได้มาจาก Middleware checkAdminAuth)
        if (req.admin.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ message: "คุณไม่มีสิทธิ์สร้างบัญชีระดับ SUPER_ADMIN ได้" });
        }

        // 🌟 4. เข้ารหัสผ่าน (Hashing) ด้วย bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 5. บันทึกลง Database
        const [result] = await connection.execute(`
            INSERT INTO officers (
                username, password, fullname,role, is_active) 
                VALUES (?, ?, ?, ?, ?)
        `, [
            username, 
            hashedPassword, // ใส่รหัสผ่านที่เข้ารหัสแล้ว (หน้าตาจะเป็นตัวอักษรมั่วๆ ยาวๆ)
            fullname, 
            role, 
            '1', 
            
        ]);

        return res.status(201).json({ 
            message: "สร้างบัญชีเจ้าหน้าที่เรียบร้อยแล้ว",
            userId: result.insertId
        });

    } catch (error) {
        console.error("Create User Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้างบัญชีผู้ใช้งาน" });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /admin/officers/:id (แก้ไขข้อมูลเจ้าหน้าที่)
app.put('/admin/officers/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const officerId = req.params.id;
        const { username, password, fullname, role, is_active } = req.body;
        const allowedRoles = ['REGISTRAR', 'VISITATION', 'COMMANDER', 'SUPER_ADMIN'];

        // 1. เช็กว่ามีเจ้าหน้าที่นี้ในระบบไหม
        const [checkUser] = await connection.execute('SELECT id, password FROM officers WHERE id = ?', [officerId]);
        if (checkUser.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลเจ้าหน้าที่ที่ต้องการแก้ไข" });
        }

        if (!username || !fullname || !role) {
            return res.status(400).json({ message: "กรุณากรอกข้อมูล Username, ชื่อ-สกุล และ Role ให้ครบถ้วน" });
        }

        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ message: "Role ไม่ถูกต้อง" });
        }

        // 2. เช็ก Username ซ้ำ (ยกเว้นตัวเอง)
        const [existingUser] = await connection.execute('SELECT id FROM officers WHERE username = ? AND id != ?', [username, officerId]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Username นี้มีคนอื่นใช้ไปแล้ว" });
        }

        // 3. จัดการเรื่องรหัสผ่าน (อัปเดตเฉพาะเมื่อมีการส่ง password ใหม่มา)
        let finalPassword = checkUser[0].password; // ตั้งต้นด้วยรหัสผ่านเดิมใน DB
        if (password && password.trim() !== '') {
            const saltRounds = 10;
            finalPassword = await bcrypt.hash(password, saltRounds); // เข้ารหัสผ่านใหม่
        }

        // 4. สั่งอัปเดตข้อมูล
        await connection.execute(`
            UPDATE officers 
            SET username = ?, password = ?, fullname = ?, role = ?, is_active = ?
            WHERE id = ?
        `, [username, finalPassword, fullname, role, is_active || '1', officerId]);

        return res.status(200).json({ message: "แก้ไขข้อมูลเจ้าหน้าที่เรียบร้อยแล้ว" });

    } catch (error) {
        console.error("Update Officer Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูล" });
    } finally {
        if (connection) connection.release();
    }
});


// DELETE /admin/officers/:id (ลบเจ้าหน้าที่ถาวร)
app.delete('/admin/officers/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const officerId = req.params.id;

        // 🌟 ทริคป้องกัน: ห้าม SUPER_ADMIN เผลอลบบัญชีตัวเองเด็ดขาด!
        // (สมมติว่าตอนล็อกอิน เราเก็บ id คนล็อกอินไว้ใน req.admin.id)
        if (req.admin.id && String(req.admin.id) === String(officerId)) {
            return res.status(400).json({ message: "ไม่อนุญาตให้ลบบัญชีของตัวเองในขณะที่กำลังใช้งานอยู่ครับ" });
        }

        const [checkUser] = await connection.execute('SELECT id FROM officers WHERE id = ?', [officerId]);
        if (checkUser.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลเจ้าหน้าที่ที่ต้องการลบ" });
        }

        await connection.execute('DELETE FROM officers WHERE id = ?', [officerId]);

        return res.status(200).json({ message: "ลบข้อมูลเจ้าหน้าที่สำเร็จเรียบร้อยแล้ว" });

    } catch (error) {
        console.error("Delete Officer Error:", error);
        
        // ดัก Error เผื่อเจ้าหน้าที่คนนี้เคยไปกดอนุมัติคิวเยี่ยมไว้ (ติด Foreign Key)
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ 
                message: "ไม่สามารถลบเจ้าหน้าที่คนนี้ได้ เนื่องจากมีประวัติการทำงานผูกอยู่ในระบบ แนะนำให้เข้าไปแก้ไขสถานะเป็น 'ระงับการใช้งาน' (is_active = 0) แทนครับ" 
            });
        }

        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบเจ้าหน้าที่" });
    } finally {
        if (connection) connection.release();
    }
});


app.get('/admin/request/pending',checkAPI_key,checkAdminAuth,checkRole(['SUPER_ADMIN','REGISTRAR']),async(req,res) => {
    try{
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1)*limit;

        const [pendingCount] = await db.execute(`SELECT COUNT(id) AS total
            FROM user_inmate_relationship
            WHERE status = 'PENDING'
            
            `) 
        const totalItem = pendingCount[0].total;
        const totalPage = Math.ceil(totalItem / limit);
        
        const [rows] = await db.execute(`
            SELECT
                ui.id AS request_id,
                u.id_card AS visitor_id_card, 
                pi.prefixes_nameTh AS visitor_prefix,
                u.firstname AS visitor_firstname,
                u.lastname AS visitor_lastname,
                u.phone,
                ui.id_card_image,
                ui.selfie_image,
                ui.status,
                rt.type_name_relationship_th,
                il.location_name,
                pi.prefixes_nameTh AS inmate_prefix,
                i.firstname AS inmate_firstname,i.lastname AS inmate_lastname

            FROM user_inmate_relationship ui
            LEFT JOIN user u ON ui.userId = u.userId
            LEFT JOIN prefixes pu ON u.prefixe_id = pu.id_prefixes
            
            JOIN incarcerations ic ON ui.inmateId = ic.inmate_rowID
            JOIN inmate i ON ui.inmateId = i.id 
            LEFT JOIN prefixes pi ON i.prefixeID = pi.id_prefixes
            LEFT JOIN inmate_location il ON ic.current_location_id = il.id
            LEFT JOIN relation_type AS rt ON ui.relationType_id = rt.id
            WHERE ui.status = 'PENDING'
            ORDER BY ui.id ASC
            LIMIT ? OFFSET ?
        `, [limit.toString(), offset.toString()]);

    res.status(200).json({
        message: 'ดึงข้อมูลรายการรอตรวจสอบสำเร็จ',
        pagination: {
            current_page: page,
            total_pages: totalPage,
            total_items: totalItem,
            items_per_page: limit
        },
        data: rows
    })


    
    console.log("ข้อมูลแอดมินที่เข้าถึง: ", req.admin)
    }catch(error){
        console.log("Error in Pending : ",error)
    }
})



app.put('/admin/request/:id/review',checkAPI_key,checkAdminAuth,checkRole(['SUPER_ADMIN','REGISTRAR']),async(req,res) => {
    try{
        
    
    const requestId = req.params.id
    const {action,reject_reason} = req.body;

    if(action !== 'APPROVED' && action !== 'REJECTED'){
        console.log("Action : ",action)
        throw new ValidationError("Action ต้องเป็น APPROVED หรือ REJECTED",400);
    
    }
    if (action === 'REJECTED' && (!reject_reason || reject_reason.trim() === '')){
        throw new ValidationError("กรุณาระบุเหตุผลการปฏิเสธคำขอ",400);
    }
    const [rows] = await db.execute(`
        SELECT id,status,id_card_image,selfie_image
        FROM user_inmate_relationship
        WHERE id = ?
        
        
        `,[requestId]);
        if (rows.length === 0){
            return res.status(404).json({message: 'ไม่พบคำขอที่ระบุ'})
        }
    const requestInfo = rows[0]
    if (requestInfo.status !== 'PENDING'){
        return res.status(400).json({message:'คำขอถูกตรวจสอบไปแล้ว สถานะปัจจุบันคือ ' + requestInfo.status});
    }

    if (action === 'APPROVED'){
        await db.execute(`
            UPDATE user_inmate_relationship
            SET status = 'APPROVED',reject_reason = NULL
            WHERE id = ?
            
            
            `,[requestId]);
    }else if (action === 'REJECTED'){
        await db.execute(`
            UPDATE user_inmate_relationship
            SET status = 'REJECTED',reject_reason = ?
            WHERE id = ?
            
            `,[reject_reason,requestId]);


            //สั่งลบรูปภาพ
            const deleteFileIfExists = (filename) => {
                if(filename){
                    const filepath = path.join(process.cwd(),'uploads',filename)
                    if (fs.existsSync(filepath)){
                        fs.unlinkSync(filepath);
                    }
                }
            }
            deleteFileIfExists(requestInfo.id_card_image);
            deleteFileIfExists(requestInfo.selfie_image);
            


    }
    res.status(200).json({
        message : `ทำรายการสำเร็จ คำขอถูก ${action === 'APPROVED' ? 'อนุมัติ' : 'ปฏิเสธ เนื่องจาก ' + reject_reason}`,
        data: {
            id : requestId,
            status : action
        }
    })



    }catch(error){
        console.error("Error in review endpoint: ", error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode || 400).json({message: error.message})

    }
    res.status(500).json({message: 'Internal Server Error'})
    }
});

app.post('/admin/inmate/excel',checkAPI_key,checkAdminAuth, checkRole(['SUPER_ADMIN','REGISTRAR']),excelUpload.single('file'),async (req,res) => {
    let connection;
    try{
        if (!req.file){
            return res.status(400).json({message:'กรุณาอัปโหลดไฟล์ Excel หรือ Csv'});

        }

    
    const workbook = xlsx.read(req.file.buffer, { type : 'buffer'});
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const data = xlsx.utils.sheet_to_json(sheet,{raw: false, // บังคับให้อ่านค่าที่ Format แล้ว (จะได้ข้อความ "02/15/2002")
    dateNF: 'yyyy-mm-dd'})

    if(data.length === 0){
        return res.status(400).json({message: 'ไม่พบข้อมูลในไฟล์หรือไฟล์ว่างเปล่า'})
    }

    let successCount = 0;
    let updateCount = 0;
    let errorList = [];

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [zoneRows] = await connection.execute(`SELECT id, location_name FROM inmate_location`);

    const zoneMap ={};
    zoneRows.forEach(zone => {
        // ใช้ .trim() เพื่อตัดช่องว่างหน้า-หลัง เผื่อใน DB พิมพ์เว้นวรรคเกิน
        const cleanZoneName = zone.location_name.toString().trim();
        
        // จับคู่ ตัวหนังสือ = ID
        zoneMap[cleanZoneName] = zone.id; 
    });

    for (let i = 0;i < data.length ; i++){
        const row = data[i];

        const inmate_id_card = row['เลขบัตรประจำตัวประชาชน'] || row['id_card']
        const inmate_id = row['รหัส'] || row['inmate_id']
        const firstname = row['ชื่อ'] || row['firstname']
        const lastname = row['นามสกุล'] || row['lastname']
        let RawZoneText = row['แดน'] || row['zone']
        const zoneText = RawZoneText ? RawZoneText.toString().trim() : null;
        let finalZoneId = null;
        const admission_date = row['วันรับโทษ'] || row['admission_date'] || null
        const release_date = row['วันพ้นโทษ'] || row['release_date'] || null
        const gender = row['เพศ']|| row['gender']
        const birthdate = row['วันเกิด'] || row['birthdate'] || null
        
        if (!inmate_id_card||!inmate_id || !firstname || !lastname){
            errorList.push(`แถวที่ Excel ${ i + 2 } : ข้อมูลไม่ครบ (ขาดเลขบัตรประชาชน รหัสนักโทษ หรือ ชื่อ-นามสกุล)`);
            continue;
        }
        if (birthdate) {
            console.log('birthdat = ',birthdate)
        // ใส่พารามิเตอร์ตัวที่ 3 เป็น true เพื่อเปิดโหมด Strict Validation
        const isValidDate = dayjs(birthdate, 'YYYY-MM-DD', true).isValid();
        
        if (!isValidDate) {
            return res.status(400).json({ 
                message: "รูปแบบวันเกิดไม่ถูกต้อง หรือวันที่ไม่มีอยู่จริง กรุณาใช้ YYYY-MM-DD" 
            });
        }
    }

        let realInmateId;

        if (zoneText) {
            finalZoneId = zoneMap[zoneText]; // โยนคำว่า "แดน 1" เข้าไป มันจะคายเลข 1 ออกมา

            // 🚨 เช็คว่า "ถ้าหา ID ไม่เจอ (แปลว่าแอดมินพิมพ์ชื่อแดนผิด หรือไม่มีแดนนี้ในระบบ)"
            if (!finalZoneId) {
                errorList.push(`แถวที่ ${i + 2}: ไม่พบข้อมูลแดนที่ชื่อ "${zoneText}" ในระบบ กรุณาตรวจสอบการสะกดคำ`);
                continue; // ข้ามการบันทึกนักโทษคนนี้ไปเลย (เพื่อไม่ให้ระบบพัง)
            }
        }

        const [inmateRows] = await connection.execute(`
            SELECT id FROM inmate WHERE id_card = ?
            
            
            `,[inmate_id_card])

        if(inmateRows.length > 0){
            realInmateId = inmateRows[0].id
        }else{
            const [insertInmate] = await connection.execute(`
                INSERT INTO inmate (id_card,firstname,lastname,birthdate,gender) VALUES (?,?,?,?,?)
                
                `,[inmate_id_card,firstname,lastname,birthdate,gender])
            realInmateId = insertInmate.insertId
        }

        

        const [incarcerationRows] = await connection.execute(`
            SELECT inmate_rowID FROM incarcerations WHERE inmate_id = ?
            
            `,[inmate_id]);


            //ถ้ามีรหัสนี้อยู่แล้ว
        if(incarcerationRows.length > 0) {
            await connection.execute(`
                UPDATE incarcerations SET current_location_id = ? WHERE inmate_id = ?
                
                `,[finalZoneId, inmate_id]);

            updateCount++;




        }else{

            //ถ้าไม่มี
            await connection.execute(`
                INSERT INTO incarcerations (inmate_rowID,inmate_id,admission_date,release_date,current_location_id)
                VALUES (?,?,?,?,?)
                `,[realInmateId,inmate_id,admission_date,release_date,finalZoneId])
                successCount++;
        }

    }
    await connection.commit();
    res.status(200).json({
        message:'ประมวลไฟล์ Excel',
        summary: {
            total_rows :data.length,
            inserted: successCount,
            updated: updateCount,
            failed: errorList.length,
            errors: errorList
    }
    })


    }catch(error){
        if (connection) await  connection.rollback();
        console.error(error)
        res.status(500).json({ message : 'เกิดข้อผิดพลาดในการประมวลผลไฟล์'})

    }finally {
        if (connection) connection.release(); 
    }


})



// ==========================================
// 📅 API สำหรับ Admin สร้างรอบ (เพิ่มการรองรับ device_id)
// ==========================================
app.get('/admin/devices', checkAPI_key, checkAdminAuth, async (req, res) => {
    try {
        // ดึงอุปกรณ์ทั้งหมดมาโชว์ (ถ้าตารางคุณมีสถานะ เปิด/ปิด ใช้งาน ก็ใส่ WHERE เพิ่มได้ครับ)
        const [devices] = await db.execute(`SELECT id, device_name, platforms FROM devices`);
        
        res.status(200).json({
            message: "ดึงข้อมูลอุปกรณ์สำเร็จ",
            data: devices
        });

    } catch (error) {
        console.error("Get Devices Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลอุปกรณ์" });
    }
});


app.post('/admin/visit-slots/generate-advanced', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    try {
        const { schedules, is_preview = false } = req.body; 

        if (!schedules || !Array.isArray(schedules) || schedules.length === 0) {
            return res.status(400).json({ message: "กรุณาส่งข้อมูลตารางเวลาอย่างน้อย 1 รายการ" });
        }

        const slotsToInsert = [];
        const previewList = []; 

        const [deviceRows] = await db.execute(`SELECT id, device_name,platforms FROM devices`);
        
        const deviceMap = {};
        deviceRows.forEach(device => {
            // จับคู่ ID กับ Object ที่เก็บทั้งชื่อและแพลตฟอร์ม
            deviceMap[device.id] = {
                name: device.device_name,
                platform: device.platforms
            }; 
        });


        const uniqueDates = [...new Set(schedules.map(s => s.date))];
        const existingSlotsSet = new Set(); // ตะกร้าเก็บรอบที่เคยสร้างไปแล้ว


        if (uniqueDates.length > 0) {
            // สร้างเครื่องหมาย ? ตามจำนวนวันที่ เพื่อใช้ในคำสั่ง IN (?, ?, ...)
            const placeholders = uniqueDates.map(() => '?').join(',');
            
            // ดึงรอบที่มีอยู่แล้วใน DB ออกมา
            const [existingRows] = await db.query(
                `SELECT visit_date, starts_at, device_id FROM visit_slot WHERE visit_date IN (${placeholders})`,
                uniqueDates
            );

            // เอามาแปลงเป็น Key รหัสลับ เช่น "2026-03-09_09:00:00_1" (วันที่_เวลา_อุปกรณ์)
            existingRows.forEach(row => {
                // เคลียร์ Format วันที่ให้เป็น YYYY-MM-DD เพื่อให้เทียบกันได้เป๊ะๆ
                const d = new Date(row.visit_date);
                const dStr = d.toLocaleDateString('en-CA'); // จะได้ Format YYYY-MM-DD
                const devId = row.device_id || 'NULL';
                
                existingSlotsSet.add(`${dStr}_${row.starts_at}_${devId}`);
            });
        }
        
        // ตะกร้าเก็บรอบใหม่ที่กำลังจะสร้าง (กันแอดมินส่งข้อมูลซ้ำมาใน Request เดียวกันเอง)
        const newSlotsSet = new Set();



        for (let i = 0; i < schedules.length; i++) {
            const config = schedules[i];
            
            // 🌟 1. รับค่า device_id เพิ่มเข้ามาตรงนี้ครับ
            const { date, start_time, end_time, duration_minutes, break_minutes, capacity, allowed_gender, device_id } = config;

            if (!date || !start_time || !end_time || !duration_minutes || !capacity) continue; 

            let [currentHour, currentMinute] = start_time.split(':').map(Number);
            const [endHour, endMinute] = end_time.split(':').map(Number);
            
            let currentTotalMinutes = (currentHour * 60) + currentMinute;
            const totalEndMinutes = (endHour * 60) + endMinute;

            while (currentTotalMinutes + duration_minutes <= totalEndMinutes) {
                
                const slotStartH = Math.floor(currentTotalMinutes / 60).toString().padStart(2, '0');
                const slotStartM = (currentTotalMinutes % 60).toString().padStart(2, '0');
                const starts_at = `${slotStartH}:${slotStartM}:00`;

                const slotEndTotal = currentTotalMinutes + duration_minutes;
                const slotEndH = Math.floor(slotEndTotal / 60).toString().padStart(2, '0');
                const slotEndM = (slotEndTotal % 60).toString().padStart(2, '0');
                const ends_at = `${slotEndH}:${slotEndM}:00`;

                // 🌟 2. เพิ่ม device_id เข้าไปใน Array ที่จะ Insert
                

                const slotKey = `${date}_${starts_at}_${device_id || 'NULL'}`;

                // 🌟 ตรวจสอบว่า "รหัสลับนี้มีอยู่แล้วใน DB" หรือ "ซ้ำกับรอบที่เพิ่งสร้างในลูปนี้" หรือไม่?
                const isDuplicate = existingSlotsSet.has(slotKey) || newSlotsSet.has(slotKey);

                if (!isDuplicate) {
                    // ✅ ถ้าไม่ซ้ำ ให้เก็บเตรียม Insert และจดจำไว้ในตะกร้า newSlotsSet
                    slotsToInsert.push([
                        date, starts_at, ends_at, capacity, 0, 'OPEN', allowed_gender || null, device_id || null
                    ]);
                    newSlotsSet.add(slotKey);
                }

                let readableDeviceName = 'ไม่ระบุอุปกรณ์';
                let readablePlatform = 'ไม่ระบุ';
                if (device_id && deviceMap[device_id]) {
                    readableDeviceName = deviceMap[device_id].name;
                    readablePlatform = deviceMap[device_id].platform;
                } else if (device_id) {
                    readableDeviceName = `อุปกรณ์ ID: ${device_id}`;
                }
                // 🌟 3. เพิ่มลงในตัวพรีวิวให้แอดมินเช็คด้วย
                previewList.push({
                    date: date,
                    start_time: starts_at,
                    end_time: ends_at,
                    capacity: capacity,
                    device_name: readableDeviceName,
                    platform: readablePlatform,
                    allowed_gender: allowed_gender || 'รับรวมชาย-หญิง',
                    status: isDuplicate ? 'DUPLICATE (ข้ามการสร้าง)' : 'NEW (พร้อมสร้าง)' // 🌟 บอกแอดมินชัดๆ!
                });

                currentTotalMinutes += duration_minutes + (break_minutes || 0);
            }
        }

        if (slotsToInsert.length === 0) {
            return res.status(400).json({ 
                message: "รอบเวลาที่คุณต้องการสร้าง มีอยู่ในระบบทั้งหมดแล้ว (ไม่มีการสร้างใหม่)" 
            });
        }

        if (is_preview === true) {
            return res.status(200).json({
                message: "แสดงตัวอย่างรอบการจอง (ยังไม่บันทึก)",
                summary: { total_slots_generated: previewList.length },
                preview_data: previewList 
            });
        }

        // 🌟 4. แก้คำสั่ง SQL ให้มีช่อง device_id ด้วย
        const sql = `
            INSERT INTO visit_slot 
            (visit_date, starts_at, ends_at, capacity, current_booking, status, allowed_gender, device_id) 
            VALUES ?
        `;
        
        const [result] = await db.query(sql, [slotsToInsert]);

        res.status(201).json({
            message: "สร้างรอบการจองแบบกำหนดเวลาเองสำเร็จ",
            summary: {
                total_configs_processed: schedules.length,
                total_slots_created: result.affectedRows
            }
        });

    } catch (error) {
        console.error("Generate Advanced Slots Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้างรอบการจอง" });
    }
});

// ==========================================
// 📅 API สำหรับ Admin ดึงรายการรอบการเยี่ยมทั้งหมด (รองรับการ Filter)
// ==========================================
app.get('/admin/visit-slots', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    try {
        // 1. รับค่าตัวกรองจาก Query String (เช่น ?start_date=2026-03-09&status=OPEN)
        const { start_date, end_date, status, device_id } = req.query;

        // 2. สร้างเงื่อนไข (WHERE clause) แบบไดนามิก
        let whereConditions = [];
        let queryParams = [];

        if (start_date) {
            whereConditions.push('vs.visit_date >= ?');
            queryParams.push(start_date);
        }
        if (end_date) {
            whereConditions.push('vs.visit_date <= ?');
            queryParams.push(end_date);
        }
        if (status) {
            whereConditions.push('vs.status = ?');
            queryParams.push(status);
        }
        if (device_id) {
            whereConditions.push('vs.device_id = ?');
            queryParams.push(device_id);
        }

        // ประกอบร่าง WHERE ถ้ามีเงื่อนไข
        let whereSQL = '';
        if (whereConditions.length > 0) {
            whereSQL = 'WHERE ' + whereConditions.join(' AND ');
        }

        // 3. 🌟 คำสั่ง SQL สุดเทพ: ดึงข้อมูลจาก visit_slot แล้ว JOIN ไปเอาชื่อจาก devices
        const sql = `
            SELECT 
                vs.id, 
                vs.visit_date, 
                vs.starts_at, 
                vs.ends_at, 
                vs.capacity, 
                vs.current_booking, 
                (vs.capacity - vs.current_booking) AS available_seats, -- 🌟 คำนวณที่ว่างให้ด้วยเลย!
                vs.status, 
                vs.allowed_gender,
                vs.device_id,
                d.device_name,
                d.platforms AS platform
            FROM visit_slot vs
            LEFT JOIN devices d ON vs.device_id = d.id
            ${whereSQL}
            ORDER BY vs.visit_date ASC, vs.starts_at ASC, vs.device_id ASC
        `;

        const [slots] = await db.execute(sql, queryParams);

        // 4. จัด Format วันที่ให้สวยงามก่อนส่งกลับ
        const formattedSlots = slots.map(slot => ({
            ...slot,
            status : slot.available_seats < 1 ? 'FULL' : slot.status,
            
            // แปลงวันที่ให้เป็น YYYY-MM-DD แบบไม่ติด Timezone เพี้ยนๆ
            visit_date: new Date(slot.visit_date).toLocaleDateString('en-CA')
        }));

        res.status(200).json({
            message: "ดึงข้อมูลรอบการเยี่ยมสำเร็จ",
            total_records: formattedSlots.length,
            data: formattedSlots
        });

    } catch (error) {
        console.error("Get Visit Slots Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลรอบการเยี่ยม" });
    }
});

// ==========================================
// 🗑️ API สำหรับ Admin ลบรอบเวลา (Visit Slot)
// ==========================================
app.delete('/admin/visit-slots/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    try {
        const slotId = req.params.id;

        // 1. ดึงข้อมูลรอบเวลามาตรวจสอบก่อน
        const [existingSlot] = await db.execute(`SELECT current_booking FROM visit_slot WHERE id = ?`, [slotId]);
        
        if (existingSlot.length === 0) {
            return res.status(404).json({ message: "ไม่พบรอบเวลานี้ในระบบ หรือถูกลบไปแล้ว" });
        }

        const currentBooking = existingSlot[0].current_booking;

        // 2. 🚨 ดักบั๊กความปลอดภัย: เช็คว่ามีคนจองไปแล้วหรือยัง?
        if (currentBooking > 0) {
            return res.status(400).json({ 
                message: `ไม่อนุญาตให้ลบรอบเวลานี้! เนื่องจากมีญาติทำการจองคิวเข้ามาแล้วจำนวน ${currentBooking} คิว (หากต้องการยกเลิก กรุณายกเลิกคิวของญาติก่อน หรือเปลี่ยนสถานะรอบเป็น 'CLOSED' แทน)` 
            });
        }

        // 3. ✅ ถ้ายังไม่มีใครจอง (current_booking = 0) ทำการลบทิ้งออกจากฐานข้อมูลได้เลย
        await db.execute(`DELETE FROM visit_slot WHERE id = ?`, [slotId]);

        res.status(200).json({ message: "ลบรอบการจองออกจากระบบสำเร็จ" });

    } catch (error) {
        console.error("Delete Visit Slot Error:", error);
        
        // 🚨 ดักจับ Error พิเศษ: กรณีที่ฐานข้อมูลติด Foreign Key แบบซ่อนเร้น
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ 
                message: "ไม่สามารถลบได้ เนื่องจากข้อมูลรอบเวลานี้ผูกกับประวัติการจองในระบบแล้ว" 
            });
        }

        res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบรอบการจอง" });
    }
});


// ==========================================
// 📋 API สำหรับ Admin ดึงรายชื่อการจองคิวเยี่ยมญาติ
// ==========================================
app.get('/admin/visit-bookings', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR','VISITATION']), async (req, res) => {
    try {
        const { date, slot_id, status, booking_code, inmate_id } = req.query;

        let whereConditions = [];
        let queryParams = [];

        if (date) {
            whereConditions.push('vs.visit_date = ?');
            queryParams.push(date);
        }
        if (slot_id) {
            whereConditions.push('vb.slot_id = ?');
            queryParams.push(slot_id);
        }
        if (status) {
            whereConditions.push('vb.status = ?');
            queryParams.push(status);
        }
        if (booking_code) {
            whereConditions.push('vb.booking_code = ?');
            queryParams.push(booking_code);
        }
        if (inmate_id) {
            whereConditions.push('vb.inmate_id = ?');
            queryParams.push(inmate_id);
        }

        let whereSQL = '';
        if (whereConditions.length > 0) {
            whereSQL = 'WHERE ' + whereConditions.join(' AND ');
        }

        // 1. 🌟 แก้ไข SQL: แยก firstname/lastname และเพิ่ม starts_url, platforms
        const sql = `
            SELECT 
                vb.id AS booking_id,
                vb.booking_code,
                vb.status AS booking_status,
                vb.created_at AS booked_on,
                vb.starts_url, -- 🌟 ดึงลิงก์เริ่มประชุมของ Zoom (สำหรับแอดมิน)
                vb.join_url,
                vs.visit_date,
                vs.starts_at,
                vs.ends_at,
                d.device_name,
                d.platforms, -- 🌟 ดึงชื่อแพลตฟอร์ม
                u.userId AS relative_id,
                u.firstname AS visitor_firstname, 
                u.lastname AS visitor_lastname,
                i.id AS inmate_id,
                ic.inmate_id AS inmate_number,
                i.firstname AS inmate_firstname, 
                i.lastname AS inmate_lastname
            FROM visit_booking vb
            JOIN visit_slot vs ON vb.slot_id = vs.id
            LEFT JOIN devices d ON vs.device_id = d.id
            LEFT JOIN user u ON vb.relative_user_id = u.userId
            LEFT JOIN inmate i ON vb.inmate_id = i.id
            JOIN incarcerations ic ON i.id = ic.inmate_rowID
            ${whereSQL}
            ORDER BY vs.visit_date ASC, vs.starts_at ASC, vb.created_at ASC
        `;

        const [bookings] = await db.execute(sql, queryParams);

        // 2. 🌟 สร้าง Map สำหรับแปลภาษาของสถานะ
        const statusMap = {
            'PENDING': 'รอดำเนินการ',
            'APPROVED': 'อนุมัติแล้ว',
            'CHECKED_IN': 'เช็คอินแล้ว',
            'COMPLETED': 'เยี่ยมสมบูรณ์',
            'NO_SHOW': 'ไม่มาตามนัด',
            'CANCELLED': 'ยกเลิก',
            'REJECTED': 'ไม่อนุมัติ'
        };

        // 3. 🌟 Map ข้อมูลตามโครงสร้างที่คุณต้องการ
        const formattedBookings = bookings.map(row => {
            let actionUrl = null;
            
            // แปลงวันที่เป็นรูปแบบภาษาไทย
            const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            // ตรวจสอบแพลตฟอร์มเพื่อสร้างลิงก์ (actionUrl)
            if (row.platforms === 'ZOOM') {
                actionUrl = row.starts_url || row.join_url; // ใช้ starts_url เป็นหลัก
            } else if (row.platforms === 'LINE') {
                actionUrl = `เวลา:${row.starts_at}-ชื่อ:${row.inmate_firstname}-รหัสการจอง:${row.booking_code}`;
            } else if (row.platforms === 'WEBRTC') {
                actionUrl = `https://prison-visit-booking.duckdns.org/front.html?room=${row.booking_code}`;
            }

            // ส่งคืนโครงสร้าง JSON ตามที่คุณออกแบบไว้เป๊ะๆ
            return {
                booking_id: row.booking_id,
                inmate: {
                    firstname: row.inmate_firstname,
                    lastname: row.inmate_lastname
                },
                visitor: {
                    firstname: row.visitor_firstname,
                    lastname: row.visitor_lastname
                },
                slot: {
                    booking_id: row.booking_id,
                    visit_date: thaiDate,
                    time: `${row.starts_at} - ${row.ends_at}`,
                    device_name: row.device_name,
                    status: statusMap[row.booking_status] || row.booking_status,
                    device_platform: row.platforms,
                    bookingCode: row.booking_code,
                    meeting_link: actionUrl
                }
            };
        });

        res.status(200).json({
            message: "ดึงข้อมูลการจองสำเร็จ",
            total_records: formattedBookings.length,
            data: formattedBookings
        });

    } catch (error) {
        console.error("Get Visit Bookings Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลการจอง" });
    }
});


app.get('/admin/inmates', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    try {
        const { search } = req.query; // รับคำค้นหา เช่น ?search=สมชาย หรือ ?search=67001
        
        let sql = `
            SELECT 
                i.id, 
                i.firstname, 
                i.lastname, 
                i.id_card,
                ic.inmate_id AS prisoner_number,
                il.location_name
            FROM inmate i
            -- 1. หากล่องข้อมูลล่าสุดของนักโทษแต่ละคนก่อน
            LEFT JOIN (
                SELECT inmate_rowID, MAX(id) AS latest_id
                FROM incarcerations
                GROUP BY inmate_rowID
            ) latest_record ON i.id = latest_record.inmate_rowID
            -- 2. เอาไอดีล่าสุดนั้น ไปดึงรหัสนักโทษ (inmate_id) ตัวจริงออกมา
            LEFT JOIN incarcerations ic ON latest_record.latest_id = ic.id
            LEFT JOIN inmate_location il ON ic.current_location_id = il.id
        `;
        let queryParams = [];

        // ถ้ามีการพิมพ์ค้นหามา
        if (search) {
            sql += ` WHERE i.firstname LIKE ? OR i.lastname LIKE ? OR ic.inmate_id LIKE ?`;
            const searchKeyword = `%${search}%`;
            queryParams.push(searchKeyword, searchKeyword, searchKeyword);
        }

        sql += ` ORDER BY i.id DESC LIMIT 100`; // ลิมิตไว้ 100 คนป้องกันดึงข้อมูลหนักเกินไป

        const [inmates] = await db.execute(sql, queryParams);


        res.status(200).json({
            message: "ดึงข้อมูลนักโทษสำเร็จ",
            total: inmates.length,
            data: inmates
        });
    } catch (error) {
        console.error("Get Inmates Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลนักโทษ" });
    }
});

// ==========================================
// 2. ➕ API เพิ่มข้อมูลนักโทษใหม่ (รายบุคคล)
// ==========================================
app.post('/admin/inmates', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction(); // ใช้ Transaction เผื่อพังกลางทาง

    try {
        const { id_card,prefix,firstname, lastname, birthdate,gender,inmate_number,zoneText } = req.body;

        if (!firstname || !lastname || !inmate_number) {
            return res.status(400).json({ message: "กรุณากรอก ชื่อ, นามสกุล และ รหัสนักโทษ ให้ครบถ้วน" });
        }
        if (id_card.length != 13){
            return res.status(400).json({ message: "กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก"})
        }
        if (birthdate) {
            
        // ใส่พารามิเตอร์ตัวที่ 3 เป็น true เพื่อเปิดโหมด Strict Validation
        const isValidDate = dayjs(birthdate, 'YYYY-MM-DD', true).isValid();
        
        if (!isValidDate) {
            return res.status(400).json({ 
                message: "รูปแบบวันเกิดไม่ถูกต้อง หรือวันที่ไม่มีอยู่จริง กรุณาใช้ YYYY-MM-DD" 
            });
        }
    }

        const [zoneRows] = await connection.execute(`SELECT id, location_name FROM inmate_location`);
        const zoneMap ={};
        zoneRows.forEach(zone => {
            // ใช้ .trim() เพื่อตัดช่องว่างหน้า-หลัง เผื่อใน DB พิมพ์เว้นวรรคเกิน
            const cleanZoneName = zone.location_name.toString().trim();
            
            // จับคู่ ตัวหนังสือ = ID
            zoneMap[cleanZoneName] = zone.id; 
        });


        const [prefixRows] = await connection.execute(`SELECT id_prefixes, prefixes_nameTh FROM prefixes`);
        const prefixMap ={};
        prefixRows.forEach(item => {
            // ใช้ .trim() เพื่อตัดช่องว่างหน้า-หลัง เผื่อใน DB พิมพ์เว้นวรรคเกิน
            const cleanPrefixName = item.prefixes_nameTh.toString().trim();
            
            // จับคู่ ตัวหนังสือ = ID
            prefixMap[cleanPrefixName] = item.id_prefixes; 
        });

        let finalPrefixId = null;
        if (prefix) {
            finalPrefixId = prefixMap[prefix]; // โยนคำว่า "แดน 1" เข้าไป มันจะคายเลข 1 ออกมา

            // 🚨 เช็คว่า "ถ้าหา ID ไม่เจอ (แปลว่าแอดมินพิมพ์ชื่อแดนผิด หรือไม่มีแดนนี้ในระบบ)"
            if (!finalPrefixId) {
                finalPrefixId = null;
            }
        }
        let real_inmateId;
        const [existingInmate] = await connection.execute(`
            SELECT id,id_card,firstname,lastname,gender
            FROM inmate
            WHERE id_card = ?
            
            
            `,[id_card])

        if (existingInmate.length > 0){
            real_inmateId = existingInmate[0].id
        }else{
            const [inmateResult] = await connection.execute(
            `INSERT INTO inmate (id_card,prefixeID,firstname, lastname,birthdate,allow_visit,gender) VALUES (?, ?, ?, ?,?, ?, ?)`,
            [id_card,finalPrefixId,firstname, lastname,birthdate,'1',gender]
        );
            real_inmateId = inmateResult.insertId;

        }
        

        // 1. บันทึกลงตาราง inmate ก่อน
        
        let finalZoneId = null;
        if (zoneText) {
            finalZoneId = zoneMap[zoneText]; // โยนคำว่า "แดน 1" เข้าไป มันจะคายเลข 1 ออกมา

            // 🚨 เช็คว่า "ถ้าหา ID ไม่เจอ (แปลว่าแอดมินพิมพ์ชื่อแดนผิด หรือไม่มีแดนนี้ในระบบ)"
            if (!finalZoneId) {
                finalZoneId = null;
            }
        }


        // 2. บันทึกรหัสนักโทษลงตาราง incarcerations
        await connection.execute(
            `INSERT INTO incarcerations (inmate_rowID, inmate_id,current_location_id) VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE
                current_location_id = VALUES(current_location_id)
            `,
            [real_inmateId, inmate_number,finalZoneId]
        );

        await connection.commit();
        

        res.status(201).json({
            message: existingInmate.length > 0 ? "อัปเดตประวัตินักโทษเดิมสำเร็จ" : "เพิ่มข้อมูลนักโทษใหม่สำเร็จ",
            data: { id: real_inmateId, firstname, lastname, inmate_number }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Create Inmate Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่มข้อมูลนักโทษ" });
    } finally{
        if (connection){
            connection.release()
        }
    }
});


// ✏️ API แก้ไขข้อมูลนักโทษ
// ==========================================
app.put('/admin/inmates/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction(); 

    try {
        const inmateId = req.params.id; // ดึง ID จาก URL
        const { id_card, prefix, firstname, lastname, birthdate, gender, allow_visit, inmate_number, zoneText } = req.body;

        // 1. ตรวจสอบข้อมูลเบื้องต้น
        if (!firstname || !lastname || !inmate_number) {
            return res.status(400).json({ message: "กรุณากรอก ชื่อ, นามสกุล และ รหัสนักโทษ ให้ครบถ้วน" });
        }
        if (id_card && id_card.length !== 13) {
            return res.status(400).json({ message: "กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก" });
        }
        if (birthdate) {
    // ใส่พารามิเตอร์ตัวที่ 3 เป็น true เพื่อเปิดโหมด Strict Validation
        const isValidDate = dayjs(birthdate, 'YYYY-MM-DD', true).isValid();
        
        if (!isValidDate) {
            return res.status(400).json({ 
                message: "รูปแบบวันเกิดไม่ถูกต้อง หรือวันที่ไม่มีอยู่จริง กรุณาใช้ YYYY-MM-DD" 
            });
        }
    }

        // 2. เช็คก่อนว่ามีนักโทษคนนี้ในระบบจริงๆ ไหม
        const [checkInmate] = await connection.execute(`SELECT id FROM inmate WHERE id = ?`, [inmateId]);
        if (checkInmate.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "ไม่พบข้อมูลนักโทษที่ต้องการแก้ไข" });
        }

        if (id_card) {
            const [duplicateCheck] = await connection.execute(
                `SELECT id FROM inmate WHERE id_card = ? AND id != ?`, 
                [id_card, inmateId]
            );
            
            if (duplicateCheck.length > 0) {
                await connection.rollback();
                return res.status(400).json({ 
                    message: `ไม่สามารถแก้ไขได้! เลขบัตรประชาชน ${id_card} นี้ มีประวัติของนักโทษคนอื่นในระบบแล้ว` 
                });
            }
        }

        // 3. แปลงชื่อแดน และ คำนำหน้า ให้เป็น ID
        const [zoneRows] = await connection.execute(`SELECT id, location_name FROM inmate_location`);
        const zoneMap = {};
        zoneRows.forEach(zone => zoneMap[zone.location_name.toString().trim()] = zone.id);
        const finalZoneId = zoneText ? (zoneMap[zoneText] || null) : null;

        const [prefixRows] = await connection.execute(`SELECT id_prefixes, prefixes_nameTh FROM prefixes`);
        const prefixMap = {};
        prefixRows.forEach(item => prefixMap[item.prefixes_nameTh.toString().trim()] = item.id_prefixes);
        const finalPrefixId = prefix ? (prefixMap[prefix] || null) : null;

        // 4. อัปเดตข้อมูลตารางหลัก (inmate)
        await connection.execute(`
            UPDATE inmate 
            SET id_card = ?, prefixeID = ?, firstname = ?, lastname = ?, birthdate = ?,allow_visit = ?, gender = ? 
            WHERE id = ?
        `, [id_card, finalPrefixId, firstname, lastname, birthdate,allow_visit, gender, inmateId]);

        // 5. 🌟 อัปเดตตารางรอง (incarcerations) แบบไม่ให้งอก
        const [checkIncarc] = await connection.execute(`SELECT id FROM incarcerations WHERE inmate_rowID = ?`, [inmateId]);

        if (checkIncarc.length > 0) {
            await connection.execute(`
                UPDATE incarcerations 
                SET inmate_id = ?, current_location_id = ? 
                WHERE inmate_rowID = ?
            `, [inmate_number, finalZoneId, inmateId]);
        } else {
            await connection.execute(`
                INSERT INTO incarcerations (inmate_rowID, inmate_id, current_location_id) 
                VALUES (?, ?, ?)
            `, [inmateId, inmate_number, finalZoneId]);
        }

        // เซฟการเปลี่ยนแปลง
        await connection.commit();

        res.status(200).json({ message: "แก้ไขข้อมูลนักโทษสำเร็จ" });

    } catch (error) {
        await connection.rollback();
        console.error("Update Inmate Error:", error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ 
                message: "ข้อมูลนี้ (เช่น เลขบัตร หรือ รหัสนักโทษ) มีซ้ำในระบบแล้ว กรุณาตรวจสอบอีกครั้ง" 
            });
        }
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลนักโทษ" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});
// ==========================================
// 🗑️ API ลบข้อมูลนักโทษ
// ==========================================
app.delete('/admin/inmates/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN','REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const inmateId = req.params.id;

        // 1. เช็คก่อนว่ามีนักโทษคนนี้อยู่จริงไหม
        const [checkInmate] = await connection.execute(`SELECT id FROM inmate WHERE id = ?`, [inmateId]);
        if (checkInmate.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "ไม่พบข้อมูลนักโทษที่ต้องการลบ" });
        }

        // 2. ลบข้อมูลจากตารางลูก (incarcerations) ก่อน
        await connection.execute(`DELETE FROM visit_booking WHERE inmate_id = ?`,[inmateId])
        await connection.execute(`DELETE FROM user_inmate_relationship WHERE inmateId = ?`,[inmateId])

        await connection.execute(`DELETE FROM incarcerations WHERE inmate_rowID = ?`, [inmateId]);

        // 3. ลบข้อมูลจากตารางแม่ (inmate)
        await connection.execute(`DELETE FROM inmate WHERE id = ?`, [inmateId]);

        

        // เซฟการเปลี่ยนแปลง
        await connection.commit();

        res.status(200).json({ message: "ลบข้อมูลนักโทษออกจากระบบสำเร็จ" });

    } catch (error) {
        await connection.rollback();
        console.error("Delete Inmate Error:", error);
        
        // 🚨 ดักจับ Error กรณีติด Foreign Key (เช่น มีคนจองเยี่ยมแล้ว ลบไม่ได้!)
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ 
                message: "ไม่สามารถลบได้ เนื่องจากนักโทษคนนี้มีประวัติผูกกับการจองคิวเยี่ยม (visit_booking) แล้ว" 
            });
        }
        
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบข้อมูลนักโทษ" });
    } finally {
        if (connection) {
            connection.release(); // ปล่อย Connection เสมอ
        }
    }
});

// ==========================================
// ✏️ API แก้ไขรอบเวลา (Visit Slot)
// ==========================================
app.put('/admin/visit-slots/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    try {
        const slotId = req.params.id;
        const { visit_date, starts_at, ends_at, capacity, allowed_gender, device_id, status } = req.body;

        // 1. ดึงข้อมูลรอบเดิมมาเช็คก่อน
        const [existingSlot] = await db.execute(`SELECT current_booking FROM visit_slot WHERE id = ?`, [slotId]);
        
        if (existingSlot.length === 0) {
            return res.status(404).json({ message: "ไม่พบรอบเวลานี้ในระบบ" });
        }

        const currentBooking = existingSlot[0].current_booking;

        // 2. 🚨 ดักบั๊กที่ 1: ห้ามลด Capacity (ที่นั่งทั้งหมด) ต่ำกว่าคนที่จองไปแล้ว
        if (capacity < currentBooking) {
            return res.status(400).json({ 
                message: `ไม่สามารถลดจำนวนที่นั่งได้! รอบนี้มีคนจองไปแล้ว ${currentBooking} ที่นั่ง (กำหนดที่นั่งขั้นต่ำได้คือ ${currentBooking})` 
            });
        }

        // 3. 🚨 ดักบั๊กที่ 2: เช็คว่าวัน/เวลา/ตู้ ที่แก้ไปใหม่ ไปชนกับรอบอื่นที่เปิดไว้แล้วไหม?
        // (ใส่ id != ? เพื่อบอกว่า ไม่ต้องเอาตัวมันเองมาเทียบ)
        const [duplicateCheck] = await db.execute(`
            SELECT id FROM visit_slot 
            WHERE visit_date = ? AND starts_at = ? AND device_id = ? AND id != ?
        `, [visit_date, starts_at, device_id || null, slotId]);

        if (duplicateCheck.length > 0) {
            return res.status(400).json({ message: "ไม่สามารถแก้ไขได้! วันและเวลานี้ของตู้ที่เลือก มีการเปิดรอบไว้แล้ว (คิวชนกัน)" });
        }

        // 4. อัปเดตข้อมูลลงฐานข้อมูล
        await db.execute(`
            UPDATE visit_slot 
            SET visit_date = ?, starts_at = ?, ends_at = ?, capacity = ?, allowed_gender = ?, device_id = ?, status = ?
            WHERE id = ?
        `, [visit_date, starts_at, ends_at, capacity, allowed_gender || null, device_id || null, status, slotId]);

        res.status(200).json({ message: "แก้ไขรอบเวลาสำเร็จ" });

    } catch (error) {
        console.error("Update Visit Slot Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขรอบเวลา" });
    }
});

// 📊 API สำหรับ Dashboard: ดึงตัวเลขสรุป
app.get('/api/dashboard/summary',checkAPI_key,checkAdminAuth,checkRole(['SUPER_ADMIN','COMMANDER']), async (req, res) => {
    try {
        const startDate = req.query.date || new Date().toISOString().split('T')[0];
        const range = req.query.range || 'daily';
        
        let daysToAdd = 0;
        if (range === 'weekly') {
            daysToAdd = 6; 
        }

        const endDateObj = new Date(startDate);
        endDateObj.setDate(endDateObj.getDate() + daysToAdd);
        const endDate = endDateObj.toISOString().split('T')[0];

        // 📊 1. คำสั่ง SQL สรุปตัวเลข (เหมือนเดิม)
        const sqlStats = `
            SELECT 
                COUNT(DISTINCT vb.slot_id) AS total_bookings,
                COUNT(DISTINCT CASE WHEN vb.status = 'COMPLETED' THEN vb.slot_id END) AS completed_visits,
                COUNT(DISTINCT CASE WHEN vb.status = 'CANCELLED' OR vb.status = 'REJECTED' THEN vb.slot_id END) AS cancelled_visits,
                COUNT(DISTINCT CASE WHEN vb.status = 'PENDING' THEN vb.slot_id END) AS pending_visits
            FROM visit_booking AS vb 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id 
            WHERE DATE(vs.visit_date) BETWEEN ? AND ?
        `;
        
        // 📋 2. คำสั่ง SQL ดึงรายการคิว (🌟 อัปเดตเพิ่ม JOIN ชื่อนักโทษและญาติ)
        const sqlQueueList = `
            SELECT 
                vb.id AS booking_id,
                vs.id AS slot_id,
                DATE_FORMAT(vs.visit_date, '%Y-%m-%d') AS visit_date, 
                vs.starts_at,
                vs.ends_at,
                vb.status,
                
                -- 🌟 ดึงชื่อผู้ต้องขัง (ใช้ CONCAT เอาชื่อต่อกับนามสกุล)
                -- 🚨 กรุณาแก้ i.first_name, i.last_name ให้ตรงกับคอลัมน์ในตาราง inmate ของคุณ
                CONCAT(i.firstname, ' ', i.lastname) AS inmate_name,
                
                -- 🌟 ดึงชื่อญาติ/ผู้จอง 
                -- 🚨 กรุณาแก้ u.first_name, u.last_name ให้ตรงกับคอลัมน์ตาราง users ของคุณ
                CONCAT(u.firstname, ' ', u.lastname) AS visitor_name

            FROM visit_booking AS vb 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id 
            
            -- 🌟 สั่งเชื่อมตาราง (JOIN) เพื่อไปดึงชื่อมา
            -- 🚨 กรุณาตรวจสอบ vb.inmate_id และ vb.relative_user_id ให้ตรงกับ foreign key ในตาราง booking ของคุณ
            LEFT JOIN inmate AS i ON vb.inmate_id = i.id
            LEFT JOIN user AS u ON vb.relative_user_id = u.userId

            WHERE DATE(vs.visit_date) BETWEEN ? AND ?
            AND vb.id IN (
                SELECT MAX(id) 
                FROM visit_booking 
                GROUP BY slot_id
            )
            ORDER BY vs.visit_date ASC, vs.starts_at ASC
        `;

        // ⚡ 3. รัน Query
        const [ [statsResults], [queueResults] ] = await Promise.all([
            db.query(sqlStats, [startDate, endDate]),
            db.query(sqlQueueList, [startDate, endDate])
        ]);

        const stats = statsResults[0] || { 
            total_bookings: 0, completed_visits: 0, cancelled_visits: 0, pending_visits: 0 
        };

        // 🎉 ส่งข้อมูลกลับไป
        res.json({
            viewMode: range, 
            dateRange: { start: startDate, end: endDate },
            summary: {
                totalBookings: Number(stats.total_bookings),
                completedVisits: Number(stats.completed_visits),
                cancelledVisits: Number(stats.cancelled_visits),
                pendingVisits: Number(stats.pending_visits)
            },
            queueList: queueResults // 🌟 ตอนนี้ใน Array นี้จะมี inmate_name และ visitor_name โผล่มาแล้ว!
        });

    } catch (error) {
        console.error("Dashboard API Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/dashboard/export', async (req, res) => {
    try {
        const format = req.query.format || 'csv'; 
        
        // 🗓️ 1. รับค่า startDate และ endDate (ถ้าไม่ส่งมา ให้ใช้วันนี้เป็นค่าเริ่มต้น)
        const reqStartDate = req.query.startDate || new Date().toISOString().split('T')[0];
        const reqEndDate = req.query.endDate || reqStartDate; 

        // 📊 2. คำสั่ง SQL สรุปตัวเลข (เปลี่ยนมาใช้ BETWEEN เพื่อรองรับช่วงเวลา)
        const sqlStats = `
            SELECT 
                COUNT(DISTINCT vb.slot_id) AS total_bookings,
                COUNT(DISTINCT CASE WHEN vb.status = 'COMPLETED' THEN vb.slot_id END) AS completed_visits,
                COUNT(DISTINCT CASE WHEN vb.status = 'CANCELLED' OR vb.status = 'REJECTED' THEN vb.slot_id END) AS cancelled_visits,
                COUNT(DISTINCT CASE WHEN vb.status = 'PENDING' THEN vb.slot_id END) AS pending_visits
            FROM visit_booking AS vb 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id 
            WHERE DATE(vs.visit_date) BETWEEN ? AND ?
        `;

        // 📋 3. คำสั่ง SQL ดึงคิวงาน (🌟 เพิ่ม i.id AS inmate_id และใช้ BETWEEN)
        const sqlQueueList = `
            SELECT 
                vb.id AS booking_id,
                DATE_FORMAT(vs.visit_date, '%Y-%m-%d') AS visit_date, 
                vs.starts_at,
                vs.ends_at,
                vb.status,
                ic.inmate_id AS inmate_id, -- 🌟 ดึงรหัสผู้ต้องขังมาด้วย (ถ้าตารางคุณไม่ได้ชื่อ id ให้แก้ให้ตรงนะครับ)
                CONCAT(i.firstname, ' ', i.lastname) AS inmate_name,
                CONCAT(u.firstname, ' ', u.lastname) AS visitor_name
            FROM visit_booking AS vb 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id 
            LEFT JOIN inmate AS i ON vb.inmate_id = i.id
            JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            LEFT JOIN user AS u ON vb.relative_user_id = u.userId
            WHERE DATE(vs.visit_date) BETWEEN ? AND ?
            AND vb.id IN (SELECT MAX(id) FROM visit_booking GROUP BY slot_id)
            ORDER BY vs.visit_date ASC, vs.starts_at ASC
        `;

        // ⚡ รัน Query โดยส่งพารามิเตอร์ไป 2 ตัว คือ [reqStartDate, reqEndDate]
        const [ [statsResults], [queueResults] ] = await Promise.all([
            db.query(sqlStats, [reqStartDate, reqEndDate]),
            db.query(sqlQueueList, [reqStartDate, reqEndDate])
        ]);

        const stats = statsResults[0] || { total_bookings: 0, completed_visits: 0, cancelled_visits: 0, pending_visits: 0 };
        const reportTitle = `รายงานสรุปการเยี่ยมญาติ ตั้งแต่วันที่ ${reqStartDate} ถึง ${reqEndDate}`;

        // =====================================
        // 📄 1. ส่งออกเป็น CSV
        // =====================================
        if (format === 'csv') {
            let csv = '\uFEFF'; 
            
            csv += `${reportTitle}\n`;
            csv += `ยอดการจองทั้งหมด, ${stats.total_bookings} คิว\n`;
            csv += `เข้าเยี่ยมสำเร็จ, ${stats.completed_visits} คิว\n`;
            csv += `รอดำเนินการ, ${stats.pending_visits} คิว\n`;
            csv += `ยกเลิก, ${stats.cancelled_visits} คิว\n\n`; 
            
            // 🌟 เพิ่มคอลัมน์ รหัสผู้ต้องขัง
            csv += 'รหัสจอง,วันที่,เวลาเริ่ม,เวลาจบ,สถานะ,รหัสผู้ต้องขัง,ชื่อผู้ต้องขัง,ชื่อญาติ\n';
            queueResults.forEach(row => {
                csv += `${row.booking_id},${formatThaiDate(row.visit_date)},${row.starts_at},${row.ends_at},${row.status},${row.inmate_id},${row.inmate_name},${row.visitor_name}\n`;
            });

            res.header('Content-Type', 'text/csv; charset=utf-8');
            res.attachment(`report_${reqStartDate}_to_${reqEndDate}.csv`);
            return res.send(csv);
        }

        // =====================================
        // 📊 2. ส่งออกเป็น Excel (.xlsx)
        // =====================================
        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('รายการเยี่ยมญาติ');

            // 🌟 เพิ่มคอลัมน์ รหัสผู้ต้องขัง 
            sheet.columns = [
                { width: 10 }, { width: 15 }, { width: 15 }, { width: 15 }, 
                { width: 15 }, { width: 15 }, { width: 30 }, { width: 30 }
            ];

            sheet.addRow([reportTitle]).font = { bold: true, size: 14 };
            sheet.addRow(['ยอดการจองทั้งหมด', stats.total_bookings, 'คิว']);
            sheet.addRow(['เข้าเยี่ยมสำเร็จ', stats.completed_visits, 'คิว']);
            sheet.addRow(['รอดำเนินการ', stats.pending_visits, 'คิว']);
            sheet.addRow(['ยกเลิก', stats.cancelled_visits, 'คิว']);
            sheet.addRow([]); 

            const headerRow = sheet.addRow(['รหัสจอง', 'วันที่', 'เวลาเริ่ม', 'เวลาจบ', 'สถานะ', 'รหัสผู้ต้องขัง', 'ชื่อผู้ต้องขัง', 'ชื่อญาติ']);
            headerRow.font = { bold: true };
            headerRow.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCCCCC' } };
            });

            queueResults.forEach(row => {
                sheet.addRow([row.booking_id, formatThaiDate(row.visit_date), row.starts_at, row.ends_at, row.status, row.inmate_id, row.inmate_name, row.visitor_name]);
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=report_${reqStartDate}_to_${reqEndDate}.xlsx`);
            
            await workbook.xlsx.write(res);
            return res.end();
        }

        // =====================================
        // 📕 3. ส่งออกเป็น PDF
        // =====================================
        if (format === 'pdf') {
            const doc = new PdfTable({ margin: 30, size: 'A4' });
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=report_${reqStartDate}_to_${reqEndDate}.pdf`);
            doc.pipe(res);

            // 🌟 ทริคระดับโปร: ใช้ path.join(__dirname) เพื่อสร้างที่อยู่ไฟล์แบบ Absolute Path (เต็มยศ)
            // ตัวอย่าง __dirname คือตำแหน่งของไฟล์ index.js นี้
            const fontPath = path.join(__dirname, 'fonts', 'THSarabun.ttf'); 

            // เช็คว่าไฟล์มีอยู่จริงไหมตามพาธที่ถูกต้อง
            if (fs.existsSync(fontPath)) {
                doc.font(fontPath); // เรียกใช้ฟอนต์จากพาธเต็ม
            } else {
                // 🚨 ถ้าขึ้น Error นี้ใน Log เซิร์ฟเวอร์ แปลว่าไฟล์ไม่ได้ถูกพุชขึ้นไปแน่ๆ!
                console.log("⚠️ ERROR: หาไฟล์ฟอนต์ไม่เจอที่พาธ ->", fontPath);
            }

            // ... (โค้ดพิมพ์ส่วนสรุปเหมือนเดิม) ...
            doc.fontSize(18).text(reportTitle, { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(14).text(`ยอดการจองทั้งหมด : ${stats.total_bookings} คิว`);
            doc.text(`เข้าเยี่ยมสำเร็จ      : ${stats.completed_visits} คิว`);
            doc.text(`รอดำเนินการ       : ${stats.pending_visits} คิว`);
            doc.text(`ยกเลิก            : ${stats.cancelled_visits} คิว`);
            doc.moveDown(1);

            const table = {
                headers: ["รหัส", "วันที่", "เริ่ม", "จบ", "สถานะ", "รหัสนักโทษ", "ชื่อผู้ต้องขัง", "ชื่อญาติ"],
                rows: queueResults.map(row => [
                    row.booking_id, formatThaiDate(row.visit_date), row.starts_at, row.ends_at, row.status, row.inmate_id, row.inmate_name, row.visitor_name
                ])
            };

            // 🌟 แก้ตรงนี้ให้ใช้ fontPath ด้วยเหมือนกัน
            await doc.table(table, { 
                width: 530,
                prepareHeader: () => doc.font(fontPath).fontSize(14),
                prepareRow: () => doc.font(fontPath).fontSize(12)
            });

            doc.end();
        }
        

    } catch (error) {
        console.error("Export API Error:", error);
        res.status(500).send("เกิดข้อผิดพลาดในการสร้างไฟล์รายงาน");
    }
});

app.put('/admin/visit-bookings/:id/status', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'VISITATION']), async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { status } = req.body; 

        // 1. ตรวจสอบค่า status ที่อนุญาตให้เปลี่ยนผ่าน API เส้นนี้
        const allowedStatuses = ['CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
        if (!allowedStatuses.includes(status)) {
            throw new ValidationError("สถานะไม่ถูกต้อง (ต้องเป็น CHECKED_IN, COMPLETED หรือ NO_SHOW เท่านั้น)");
        }

        // 2. ค้นหาข้อมูลการจองปัจจุบัน
        const [rows] = await db.execute('SELECT status, relative_user_id, inmate_id FROM visit_booking WHERE id = ?', [bookingId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลการจองนี้ในระบบ" });
        }

        const currentStatus = rows[0].status;

        // 3. 🚨 กฎควบคุมการเปลี่ยนสถานะ (State Machine Validation)
        if (status === 'CHECKED_IN') {
            if (currentStatus !== 'PENDING') {
                throw new ValidationError(`ไม่สามารถเช็คอินได้! สถานะปัจจุบันคือ '${currentStatus}' (คิวที่จะเช็คอินต้องได้รับการอนุมัติ PENDING แล้วเท่านั้น)`, 400);
            }
        } 
        else if (status === 'COMPLETED') {
            if (currentStatus !== 'CHECKED_IN' && currentStatus !== 'PENDING') {
                throw new ValidationError(`ไม่สามารถจบการเยี่ยมได้! สถานะปัจจุบันคือ '${currentStatus}' (ต้องเช็คอินก่อน)`, 400);
            }
        } 
        else if (status === 'NO_SHOW') { // 🌟 เพิ่มเงื่อนไข ไม่มาเยี่ยม
            if (currentStatus !== 'PENDING') {
                throw new ValidationError(`ไม่สามารถระบุว่าขาดนัดได้! เนื่องจากสถานะปัจจุบันคือ '${currentStatus}' (คิวที่จะระบุว่าไม่มาเยี่ยม ต้องอยู่ในสถานะ APPROVED เท่านั้น)`, 400);
            }
        }

        // 4. ✅ อัปเดตสถานะลงฐานข้อมูล
        await db.execute('UPDATE visit_booking SET status = ? WHERE id = ?', [status, bookingId]);

        res.status(200).json({
            message: `อัปเดตสถานะการจองเป็น ${status} สำเร็จ`,
            data: {
                booking_id: bookingId,
                previous_status: currentStatus,
                new_status: status
            }
        });

    } catch (error) {
        console.error("Update Booking Status Error:", error);
        if (error instanceof ValidationError) {
            return res.status(error.statusCode || 400).json({ message: error.message });
        }
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์ (Internal Server Error)" });
    }
});

// 📈 API สำหรับ Dashboard: กราฟสถิติการเยี่ยมย้อนหลัง 7 วัน
app.get('/api/dashboard/chart', async (req, res) => {
    try {
        // 1️⃣ สร้าง Array วันที่ย้อนหลัง 7 วันเตรียมไว้ (เพื่อให้กราฟไม่แหว่ง ถ้าวันไหนยอดเป็น 0)
        let chartData = [];
        for (let i = 6; i >= 0; i--) {
            let d = new Date();
            d.setDate(d.getDate() - i);
            // แปลงฟอร์แมตเป็น YYYY-MM-DD ให้ตรงกับ SQL
            let dateString = d.toISOString().split('T')[0]; 
            chartData.push({ date: dateString, count: 0 });
        }

        // 2️⃣ คำสั่ง SQL ดึงยอดการเยี่ยม 7 วันย้อนหลัง
        // ใช้ DATE_FORMAT เพื่อให้วันที่ออกมาเป็น String YYYY-MM-DD แบบเป๊ะๆ
        const sqlChart = `
            SELECT 
                DATE_FORMAT(vs.visit_date, '%Y-%m-%d') AS date_str, 
                COUNT(vb.id) AS count 
            FROM visit_booking AS vb 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id 
            WHERE vs.visit_date >= CURDATE() - INTERVAL 6 DAY
            GROUP BY DATE_FORMAT(vs.visit_date, '%Y-%m-%d')
            ORDER BY date_str ASC
        `;

        // 3️⃣ รัน Query
        const [rows] = await db.query(sqlChart);

        // 4️⃣ เอาข้อมูลจาก Database มาหยอดใส่ Array ที่เราเตรียมไว้
        rows.forEach(row => {
            // หาว่าข้อมูลจาก DB ตรงกับวันที่ไหนใน Array
            let targetDay = chartData.find(d => d.date === row.date_str);
            if (targetDay) {
                targetDay.count = row.count; // อัปเดตยอดจาก 0 เป็นตัวเลขจริง
            }
        });

        // 5️⃣ แยกข้อมูลเป็น 2 ก้อนเตรียมส่งให้ Frontend (React Native / Chart.js ชอบแบบนี้)
        const labels = chartData.map(d => d.date); // ก้อนวันที่ (แกน X)
        const data = chartData.map(d => d.count);  // ก้อนตัวเลข (แกน Y)

        res.json({
            labels: labels,
            data: data
        });

    } catch (error) {
        console.error("Dashboard Chart API Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. GET /admin/devices/:id (ดึงข้อมูลอุปกรณ์แค่ 1 เครื่อง สำหรับกดปุ่ม Edit)
app.get('/admin/devices/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const deviceId = req.params.id;

        // เส้นนี้จำเป็นต้องดึงข้อมูลมาทั้งหมด (รวม secret) เพราะแอดมินอาจจะต้องการแก้ไข
        const [device] = await connection.execute(`
            SELECT * FROM devices WHERE id = ?
        `, [deviceId]);

        if (device.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการ" });
        }

        res.status(200).json({
            message: "ดึงข้อมูลอุปกรณ์สำเร็จ",
            data: device[0]
        });

    } catch (error) {
        console.error("Get Device By ID Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลอุปกรณ์" });
    } finally {
        if (connection) connection.release();
    }
});

app.post('/admin/devices', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        let { 
            device_name, device_type, platforms, status,
            zoom_account_id, zoom_client_id, zoom_client_secret, 
            line_oa_id, line_oa_url 
        } = req.body;

        // 1. ตรวจสอบข้อมูลบังคับ
        if (!device_name || !platforms || platforms.length === 0) {
            return res.status(400).json({ message: "กรุณากรอกชื่ออุปกรณ์ และเลือกแพลตฟอร์มอย่างน้อย 1 อย่าง" });
        }

        // 2. แปลง Array ของ platforms ให้เป็น String คั่นด้วยลูกน้ำ (สำหรับ MySQL SET)
        // เช่น ['ZOOM', 'LINE'] -> 'ZOOM,LINE'
        const platformsStr = Array.isArray(platforms) ? platforms.join(',') : platforms;

        // 3. ตรวจสอบเงื่อนไขกุญแจ ตามแพลตฟอร์มที่เลือก
        if (platformsStr.includes('ZOOM')) {
            if (!zoom_account_id || !zoom_client_id || !zoom_client_secret) {
                return res.status(400).json({ message: "คุณเลือกแพลตฟอร์ม ZOOM กรุณากรอกข้อมูล API Key ของ Zoom ให้ครบถ้วน" });
            }
        }
        if (platformsStr.includes('LINE')) {
            if (!line_oa_id) {
                return res.status(400).json({ message: "คุณเลือกแพลตฟอร์ม LINE กรุณากรอก LINE OA ID" });
            }
        }
        const [existname] = await connection.execute(`
            SELECT id,device_name FROM devices WHERE device_name = ?
            
            
            `,[device_name])
        if (existname.length > 0 ){
            throw new ValidationError('ชื่ออุปกรณ์นี้ได้ถูกใช้งานไปแล้ว')
        }
        // เซ็ตค่า default ให้ status ถ้าไม่ได้ส่งมา
        const finalStatus = status || 'ACTIVE';

        // 4. บันทึกลง Database
        const [result] = await connection.execute(`
            INSERT INTO devices (
                device_name, device_type, prison_id, status, platforms,
                zoom_account_id, zoom_client_id, zoom_client_secret, 
                line_oa_id, line_oa_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            device_name, 
            device_type || null, 
            '1', 
            finalStatus,
            platformsStr,
            zoom_account_id || null, 
            zoom_client_id || null, 
            zoom_client_secret || null, 
            line_oa_id || null, 
            line_oa_url || null
        ]);

        res.status(201).json({ 
            message: "เพิ่มอุปกรณ์สำเร็จ", 
            deviceId: result.insertId 
        });

    } catch (error) {
        console.error("Add Device Error:", error);
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่มอุปกรณ์" });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /admin/devices/:id (แก้ไขข้อมูลอุปกรณ์)
app.put('/admin/devices/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const deviceId = req.params.id;
        let { 
            device_name, device_type, prison_id, platforms, status,
            zoom_account_id, zoom_client_id, zoom_client_secret, 
            line_oa_id, line_oa_url 
        } = req.body;

        // 1. เช็กว่ามีอุปกรณ์นี้อยู่จริงไหม
        const [checkDevice] = await connection.execute(`SELECT id FROM devices WHERE id = ?`, [deviceId]);
        if (checkDevice.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการแก้ไข" });
        }

        if (!device_name || !platforms || platforms.length === 0) {
            return res.status(400).json({ message: "กรุณากรอกชื่ออุปกรณ์ และเลือกแพลตฟอร์มอย่างน้อย 1 อย่าง" });
        }

        const platformsStr = Array.isArray(platforms) ? platforms.join(',') : platforms;

        // 2. ดัก Validation เหมือนตอน POST
        if (platformsStr.includes('ZOOM') && (!zoom_account_id || !zoom_client_id || !zoom_client_secret)) {
            return res.status(400).json({ message: "คุณเลือกแพลตฟอร์ม ZOOM กรุณากรอกข้อมูล API Key ของ Zoom ให้ครบถ้วน" });
        }
        if (platformsStr.includes('LINE') && !line_oa_id) {
            return res.status(400).json({ message: "คุณเลือกแพลตฟอร์ม LINE กรุณากรอก LINE OA ID" });
        }

        // 3. อัปเดตข้อมูล
        await connection.execute(`
            UPDATE devices 
            SET device_name = ?, device_type = ?, prison_id = ?, status = ?, platforms = ?,
                zoom_account_id = ?, zoom_client_id = ?, zoom_client_secret = ?, 
                line_oa_id = ?, line_oa_url = ?
            WHERE id = ?
        `, [
            device_name, device_type || null, prison_id || null, status || 'ACTIVE', platformsStr,
            zoom_account_id || null, zoom_client_id || null, zoom_client_secret || null, 
            line_oa_id || null, line_oa_url || null, 
            deviceId
        ]);

        res.status(200).json({ message: "แก้ไขข้อมูลอุปกรณ์สำเร็จ" });

    } catch (error) {
        console.error("Update Device Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขอุปกรณ์" });
    } finally {
        if (connection) connection.release();
    }
});

// DELETE /admin/devices/:id (ลบข้อมูลอุปกรณ์)
app.delete('/admin/devices/:id', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const deviceId = req.params.id;

        // 1. เช็กก่อนว่ามีอุปกรณ์นี้อยู่ในระบบจริงไหม
        const [checkDevice] = await connection.execute(`SELECT id FROM devices WHERE id = ?`, [deviceId]);
        
        if (checkDevice.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการลบ" });
        }

        // 2. สั่งลบข้อมูลออกจากฐานข้อมูล
        await connection.execute(`DELETE FROM devices WHERE id = ?`, [deviceId]);

        return res.status(200).json({ message: "ลบข้อมูลอุปกรณ์สำเร็จเรียบร้อยแล้ว" });

    } catch (error) {
        console.error("Delete Device Error:", error);
        
        // 🌟 ทริคระดับ Pro: ดักจับ Error กรณีที่ตู้นี้ถูกนำไปใช้จองคิวแล้ว (ติด Foreign Key)
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ 
                message: "ไม่สามารถลบอุปกรณ์นี้ได้ เนื่องจากมีประวัติการจองคิวผูกอยู่ แนะนำให้เปลี่ยนสถานะเป็น 'ปิดปรับปรุง (MAINTENANCE)' แทนครับ" 
            });
        }

        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบอุปกรณ์" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});



app.get('/', async(req,res) => {
    
    try{
        const result = await db.execute('SELECT * FROM user_inmate_relationship LIMIT 1')
        res.json({message: 'Welcome to my API',
            data : result[0]
        })
    }catch (error){
        console.error(error)
        res.status(500).json({message: 'Internal Server Error'})
    }
    
    
})
app.post('/check-idcard', checkAPI_key, async(req,res) => {
    try{
        let newUser = req.body
        if (newUser.id_card == null || newUser.id_card == undefined){
            throw new ValidationError("กรุณาระบุ ID card")
        }
        if (typeof newUser.id_card != 'string'){
            throw new ValidationError("ID card ต้องเป็น string")
        }

        const trimmedID_Card = newUser.id_card.trim()

        if (trimmedID_Card.length != 13){
            throw new ValidationError("ID card ต้องมีความยาว 13 ตัวอักษร")
        }
        
        // 🌟 ค้นหาแค่ตาราง user ว่าบัตรนี้เคยสมัครแอปไปหรือยัง
        const [check_SQL] = await db.execute('SELECT id_card, firstname, lastname FROM user WHERE id_card = ?;' , [trimmedID_Card])
        
        if (check_SQL.length > 0){
            // ถ้ามีในระบบแล้ว แปลว่าซ้ำ สมัครไม่ได้ ให้เด้งไปหน้า Login
            return res.status(409).json({
                message : "เลขบัตรประชาชนนี้มีบัญชีผู้ใช้งานในระบบแล้ว กรุณาเข้าสู่ระบบ",
                id_card : check_SQL[0].id_card,
                firstname : check_SQL[0].firstname,
                lastname : check_SQL[0].lastname
            })
        }

        // ถ้าค้นหาไม่เจอ แสดงว่าบัตรนี้ยังไม่เคยสมัคร ให้ผ่านได้เลย
        return res.status(200).json({
            message : "เลขบัตรประชาชนนี้สามารถใช้สมัครสมาชิกได้",
            id_card : trimmedID_Card
        })

    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }
})

app.post('/register', checkAPI_key, async(req,res) => {
    let connection;
    let newUser = req.body
    let password = newUser.password

    try {
        if (newUser.id_card == undefined || newUser.id_card.length != 13){
            throw new ValidationError("ID card ต้องมีความยาว 13 ตัวอักษร")
        }
        if (newUser.firstname == undefined || newUser.lastname == undefined || newUser.firstname.length == 0 || newUser.lastname.length == 0 || newUser.firstname.trim() == '' || newUser.lastname.trim() == ''){
            throw new ValidationError("ชื่อหรือนามสกุลไม่ถูกต้อง")
        }
        if (password == undefined){
            throw new ValidationError('Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค')
        }

        // เช็ครหัสผ่าน
        const trimmedPassword = password.trim()
        const hasnonAscii = /[^\x00-\x7F]/.test(trimmedPassword)
        if (hasnonAscii){
            throw new ValidationError('Password ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลขเท่านั้น')
        }
        if (trimmedPassword == ''){
            throw new ValidationError('Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค')
        }
        if (trimmedPassword.length < 8){
            throw new ValidationError('Password นี้ต้องมีความยาวอย่างน้อย 8 ตัวอักษร')
        } 
        if (trimmedPassword.length > 50){
            throw new ValidationError('Password นี้ต้องมีความยาวไม่เกิน 50 ตัวอักษร')
        }

        // เช็คเบอร์โทร
        if (newUser.phone == undefined || newUser.phone.length != 10) {
            throw new ValidationError("เบอร์โทรศัพท์ต้องมีความยาว 10 ตัวอักษร")
        }
        if (newUser.phone.startsWith('0') == false){
            throw new ValidationError("เบอร์โทรศัพท์ต้องขึ้นต้นด้วยเลข 0")
        }
        if (typeof newUser.phone != 'string'){
            throw new ValidationError("เบอร์โทรศัพท์ต้องเป็น string")
        }
        if (typeof newUser.firstname != 'string'){
            throw new ValidationError("ชื่อ ต้องเป็นตัวอักษร")
        }
        if (typeof newUser.lastname != 'string'){
            throw new ValidationError("นามสกุล ต้องเป็นตัวอักษร")
        }
        if (newUser.prefixe == undefined || typeof newUser.prefixe != 'string'){
            throw new ValidationError("คำนำหน้าชื่อ ไม่ถูกต้อง")
        }
        
        connection = await db.getConnection()
        await connection.beginTransaction()

        // 🌟 1. แมพคำนำหน้าชื่อ (String) ให้เป็น ID_PREFIXES (Number)
        const trimmedPrefix = newUser.prefixe.trim();
        const [prefixRows] = await connection.execute('SELECT id_prefixes FROM prefixes WHERE prefixes_nameTh = ?', [trimmedPrefix]);
        
        if (prefixRows.length === 0) {
            // ถ้าพิมพ์คำนำหน้ามาแปลกๆ แล้วหาในฐานข้อมูลไม่เจอ
            console.log("prefix = : ",newUser.prefixe);
            throw new ValidationError("คำนำหน้าชื่อไม่ถูกต้อง หรือไม่มีในระบบ");
        }
        const finalPrefixId = prefixRows[0].id_prefixes; // ได้ ID ตัวเลขมาแล้ว!

        // 🌟 2. ตรวจสอบว่า ID Card นี้มีบัญชีผู้ใช้ในระบบแล้วหรือยัง
        const [existingUser] = await connection.execute('SELECT id_card FROM user WHERE id_card = ? FOR UPDATE;' , [newUser.id_card])
        if (existingUser.length > 0){
            throw new ValidationError("เลขบัตรประชาชนนี้มีบัญชีผู้ใช้งานในระบบแล้ว กรุณาเข้าสู่ระบบ")
        }

        // 🌟 3. ตรวจสอบเบอร์โทรศัพท์ซ้ำ
        const [checkPhone_SQL] = await connection.execute('SELECT phone FROM user WHERE phone = ? ;', [newUser.phone])
        if (checkPhone_SQL.length > 0){
            throw new ValidationError("เบอร์โทรศัพท์นี้มีผู้ใช้งานแล้ว")
        }

        // 🌟 4. Hash password ด้วย bcrypt
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(trimmedPassword, saltRounds)
        
        // 🌟 5. สร้างบัญชีใหม่ (ใช้ finalPrefixId แทน newUser.prefixe)
        const sql = 'INSERT INTO `user` (`id_card`,`prefixe_id`, `firstname`, `lastname`, `hashed_password`, `create_time`, `phone`, `is_active`, `last_active_at`) VALUES (?, ?, ?, ?, ?, NOW(), ?, 1, NULL);'
        
        // ส่งตัวแปร finalPrefixId เข้าไปบันทึกลง Database
        const params = [newUser.id_card, finalPrefixId, newUser.firstname.trim(), newUser.lastname.trim(), hashedPassword, newUser.phone]
        const result = await connection.execute(sql, params)
        
        await connection.commit()
        const data = result[0]
        
        return res.status(201).json({
            message : 'สมัครสมาชิกสำเร็จ! คุณสามารถเข้าสู่ระบบและส่งคำขอผูกรายชื่อผู้ต้องขังได้เลย',
            data : {
                id : data.insertId,
                id_card : newUser.id_card,
                prefixe : trimmedPrefix, // ส่งชื่อคำนำหน้า (String) กลับไปให้ Frontend โชว์สวยๆ
                firstname : newUser.firstname.trim(),
                lastname : newUser.lastname.trim(),
                phone : newUser.phone
            }
        })
        
    }catch (error){
        console.error('Error during registration:', error)
        if (connection){
            try{
                await connection.rollback()
            }catch (err){
                console.error('Error during rollback:', err)
            }
        }
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        if (!res.headersSent){
            res.status(500).json({message: 'Internal Server Error'})
        }
    }finally{
        if (connection){
            try{
                connection.release()
            }catch (err){
                console.error('Error during release:', err)
            }
        }
    }
})


app.post('/login', checkAPI_key, async(req,res) => {
    try{
        const { id_card, password ,device_token, device_type} = req.body
        if (!id_card || typeof id_card != 'string' || !password || typeof password != 'string'){
            throw new ValidationError("เลขบัตรประชาชน หรือ รหัสผ่านของคุณไม่ถูกต้อง")    
        }
        const trimmedID_Card = id_card.trim()
        const trimmedPassword = password.trim()

        if (trimmedID_Card.length != 13 || trimmedPassword.length === 0){
            throw new ValidationError("เลขบัตรประชาชน หรือ รหัสผ่านของคุณไม่ครบ")
        }

        const [rows] = await db.execute('SELECT userId ,firstname,id_card, hashed_password ,is_active ,last_active_at FROM user WHERE id_card = ?' ,[trimmedID_Card])
        if (rows.length === 0){
            throw new ValidationError("ไม่พบผู้ใช้ในระบบ",401)
        }
        const data = rows[0]
        const isFirst_login = (data.last_active_at == null)

        console.log("ข้อมูลผู้ใช้ที่ดึงมา: ", data)
        const passwordMatch = await bcrypt.compare(trimmedPassword, data.hashed_password)
        if (!passwordMatch){
            throw new ValidationError("เลขบัตรประชาชน หรือ รหัสผ่านของคุณไม่ถูกต้อง",401)
        }
        
        if(!data.is_active || data.is_active === 0){
            throw new ValidationError("บัญชีของคุณโดนระงับ",401)
        }
        
        // สร้าง token
        const payload = { userId: data.userId, id_card: data.id_card }
        const secret_key = process.env.JWT_SECRET
        const options = { expiresIn: '1h' }
        const token = jwt.sign(payload, secret_key, options)

        const update_last_active = await db.execute("UPDATE user SET last_active_at = NOW() WHERE userId = ? ",[data.userId])

        // 🌟 แก้ไข: เติม await ให้แล้ว ป้องกันบั๊กการรันแบบ Asynchronous ที่ไม่สมบูรณ์
        if (device_token){
            await db.execute("INSERT INTO device (user_id,device_info,device_type,last_active_at) VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), last_active_at = NOW()",[data.userId,device_token,device_type || 'unknown'])
        }
        if (update_last_active.affectedRows === 0){
            throw new ValidationError("ไม่สามารถ Update เวลาที่ใช้งานล่าสุดได้")
        }
        const [relRows] = await db.execute(`
            SELECT status, reject_reason 
            FROM user_inmate_relationship 
            WHERE userId = ? 
            ORDER BY FIELD(status, 'APPROVED', 'PENDING', 'REJECTED'), id DESC 
            LIMIT 1
            `, [data.userId]);
        // 🌟 เพิ่มเติมฟีเจอร์สำหรับ Flow ใหม่: ดึงสถานะการผูกบัญชีล่าสุดส่งไปให้แอปด้วยเลย
        let claim_status = 'NONE'; // ค่าเริ่มต้น: ยังไม่เคยผูกนักโทษ
        let reject_reason = null;
           // ตัวแปรเช็กว่าให้เข้าสู่ระบบได้ไหม

        if (relRows.length > 0) {
            claim_status = relRows[0].status; // จะได้สถานะที่ดีที่สุดของญาติคนนี้มา
            reject_reason = relRows[0].reject_reason;

            
        }

        // 🌟 3. นำไปดักการเข้าสู่ระบบ
        
        return res.json({
            message : 'Login successful',
            message2 : 'ยินดีต้อนรับ คุณ ' + data.firstname,
            id_card : data.id_card,
            token : token,
            isFirst_login : isFirst_login,
            // 🌟 ส่ง 2 ตัวนี้ไปให้ Frontend ตัดสินใจว่าจะพาไปหน้าไหนต่อ
            claim_status : claim_status, 
            reject_reason : reject_reason
        })

    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }
})

app.post('/admin/login',checkAPI_key, async(req,res) => {

    try{
        const {username,password} = req.body
        if (!username || typeof username != 'string' || !password || typeof password != 'string'){
            throw new ValidationError("ชื่อผู้ใช้ หรือ รหัสผ่านของคุณไม่ถูกต้อง",400)
        }
        const trimmedUsername = username.trim()
        const trimmedPassword = password.trim()
        if (trimmedUsername.length === 0 || trimmedPassword.length === 0){
            throw new ValidationError("ชื่อผู้ใช้ หรือ รหัสผ่านของคุณไม่ถูกต้อง",400)
        }
        const [rows] = await db.execute('SELECT id,username,password,fullname,role,is_active FROM officers WHERE username = ?',[trimmedUsername])

        if (rows.length === 0){
            throw new ValidationError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",401)
        }
        const data = rows[0]
        if (data.is_active === 0){
            console.log('บัญชีนี้โดนระงับการใช้งาน')
            throw new ValidationError("บัญชีของคุณโดนระงับ",403)
        }
        
        const passwordMatch = await bcrypt.compare(trimmedPassword, data.password)
        if (!passwordMatch){
            throw new ValidationError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",401)
        }

        const payload = {
            userId: data.id,
            role: data.role
        }

        const token = jwt.sign(payload,process.env.JWT_SECRET,{expiresIn: '8h'});

        res.status(200).json({
            message: 'Login successful',
            token: token,
            data : {
                id: data.id,
                fullname: data.fullname,
                role: data.role
            }
        })





    }catch(error){
        console.log("แอดมิน login error:", error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message:'Internal Server Error'})

    }

});


app.get('/admin/request/image/:filename', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR']), (req, res) => {
    try {
        // 1. รับชื่อไฟล์จาก URL (เช่น /admin/request/image/id_card-1234.jpg)
        const filename = req.params.filename;

        // 2. 🛡️ ป้องกันการแฮกแบบ Directory Traversal (เช่น พิมพ์ชื่อไฟล์เป็น ../../etc/password)
        // path.basename จะตัดพวก ../ ออกให้เหลือแค่ชื่อไฟล์เพียวๆ ครับ
        const safeFilename = path.basename(filename); 
        
        // 3. สร้างพาร์ทเต็มๆ ชี้ไปที่โฟลเดอร์ uploads
        const filePath = path.join(process.cwd(), 'uploads', safeFilename);

        // 4. เช็คว่ามีไฟล์นี้อยู่จริงๆ ไหม?
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'ไม่พบรูปภาพนี้ในระบบ หรือรูปอาจถูกลบไปแล้ว' });
        }

        // 5. 🚀 ส่งไฟล์รูปภาพกลับไปให้เบราว์เซอร์ตรงๆ
        res.sendFile(filePath);

    } catch (error) {
        console.error("Error in Get Image : ", error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/main' , checkAPI_key,checkAuth, async (req,res) => {

    try{
        const myUserId = req.user.userId
        const [rows] = await db.execute('SELECT u.id_card,u.firstname,u.lastname, p.prefixes_nameTh AS prefix_name FROM user AS u LEFT JOIN prefixes AS p ON u.prefixe_id = p.id_prefixes WHERE u.userId = ?',[myUserId])
        if (rows.length === 0){
            return res.status(404).json({message: 'User not found'})
        }
        data = rows[0]
        res.status(200).json({
            message : 'Welcome to the main route',
            user : {
                id_card : data.id_card,
                fullname : data.prefix_name + data.firstname + ' ' + data.lastname
            }

        })
        
    }catch (error){
        return res.status(500).json({message: 'Internal Server Error'})
    }

})

app.get('/inmate_info', checkAPI_key,checkAuth, async (req,res) => {

    try{
        const myUserId = req.user.userId
        const [inmate] = await db.execute(`SELECT u.userId, u.inmateId , p.prefixes_nameTh , i.firstname ,i.lastname , i.inmate_photo_url ,i.allow_visit ,ic.inmate_id AS inmate_number FROM user_inmate_relationship AS u JOIN incarcerations AS ic ON u.inmateId = ic.inmate_rowID LEFT JOIN inmate AS i ON u.inmateId = i.id LEFT JOIN prefixes AS p ON i.prefixeID = p.id_prefixes WHERE u.userId = ? AND u.status = 'APPROVED'`,[myUserId])
        
        if (inmate.length === 0){
            res.status(200).json({
                message : 'ไม่มีข้อมูลผู้ต้องขังที่เกี่ยวข้อง',
                data : []
            })
            return
        }
        console.log("ข้อมูลผู้ต้องขังที่เกี่ยวข้อง: ", inmate)
        
        const inmateList = inmate.map(item => ( {
            

            
            id : item.inmateId,
            inmate_number : item.inmate_number,
            fullname : (item.prefixes_nameTh || '') + ' ' + item.firstname + ' ' + item.lastname,
            photo_url : item.inmate_photo_url,
            allow_visit : item.allow_visit === 1 ? 'ผู้ต้องขังนี้สามารถรับการเยี่ยมชมได้' : 'ผู้ต้องขังนี้ไม่สามารถรับการเยี่ยมชมได้ เนื่องจากมีเหตุผลบางประการ เช่น สุขภาพไม่ดี หรือ อยู่ในระหว่างการถูกลงโทษ'
        }))

        res.status(200).json({
            message : 'ข้อมูลผู้ต้องขังที่เกี่ยวข้อง',
            count : inmateList.length,
            data : inmateList
        })

    }catch (error){
        console.log(error)
        res.status(500).json({message: 'Internal Server Error'})
    }
})

app.get('/inmate_info/:id', checkAPI_key,checkAuth, async (req,res) => {
    try{
        const inmateId = req.params.id
        const myUserId = req.user.userId
        const sql = `
                        SELECT n.inmate_id ,p.prefixes_nameTh, i.firstname ,i.lastname ,rt.type_name_relationship_th,DATE_FORMAT(i.birthdate, '%d/%m/%Y') AS birthdate, i.inmate_photo_url ,n.case_type ,DATE_FORMAT(n.admission_date, '%d/%m/%Y') AS admission_date , DATE_FORMAT(n.release_date, '%d/%m/%Y') AS release_date ,n.status ,t.inmate_type ,l.location_name ,r.prison_name, TIMESTAMPDIFF( YEAR, i.birthdate, CURDATE() ) AS age
                        FROM user_inmate_relationship AS u 
                        LEFT JOIN inmate AS i ON u.inmateId = i.id 
                        LEFT JOIN prefixes as p ON i.prefixeID =  p.id_prefixes 
                        LEFT JOIN incarcerations AS n ON n.inmate_rowID = i.id 
                        LEFT JOIN relation_type AS rt ON u.relationType_id = rt.id
                        LEFT JOIN inmate_type AS t ON i.inmate_type = t.id
                        LEFT JOIN inmate_location AS l ON n.current_location_id = l.id 
                        LEFT JOIN prisons AS r ON l.prison_id = r.id
                        WHERE u.userId = ? AND u.inmateId = ?
                    `

        const [rows] = await db.execute(sql,[myUserId, inmateId])
        console.log("ผลลัพธ์การดึงข้อมูลผู้ต้องขัง: ", rows)
        if (rows.length === 0){
            return res.status(404).json({message: 'ไม่พบข้อมูลผู้ต้องขังที่เกี่ยวข้อง'})
        }
        
        const data = rows[0]
        const statusMap = {
            'ACTIVE' : 'อยู่ระหว่างการรับโทษ',
            'PAROLE' : 'ได้รับการปล่อยตัวชั่วคราว',
            'RELEASED' : 'ได้รับการปล่อยตัวแล้ว',
            'TRANSFERRED' : 'ถูกย้ายเรือนจำ',
            'ESCAPED' : 'หลบหนี'
        }
        const status_th = statusMap[data.status] || 'ไม่ทราบสถานะ'
        res.status(200).json({
            message : 'ข้อมูลผู้ต้องขัง',
            data : {
                inmate_photo_url : data.inmate_photo_url,
                inmate_id : data.inmate_id,
                fullname : (data.prefixes_nameTh || '') + ' ' + data.firstname + ' ' + data.lastname,
                age : data.age,
                birthdate : data.birthdate,
                
                relation : data.type_name_relationship_th,
                location_name : data.location_name + ' / ' + data.prison_name,
                status : status_th,
                
                admission_date : data.admission_date,
                release_date : data.release_date,
                
                
                
                
            }
        })
    }catch (error){
        console.error(error)
        res.status(500).json({message: 'Internal Server Error'})
    }
})

app.get('/inmate/slot', checkAPI_key,checkAuth, async (req,res) => {

    try{
        const {date} = req.query
        const myUserId = req.user.userId
        const Max_Quota_Per_Month = 2

        if (!date){
            throw new ValidationError("กรุณาระบุ date")

        }
        const dateObj = new Date(date)
        if (isNaN(dateObj.getTime())){
            throw new ValidationError("รูปแบบ date ไม่ถูกต้อง ควรเป็น YYYY-MM-DD")
        }
        const year = dateObj.getFullYear()
        const month = dateObj.getMonth() + 1
        


// ต้องเปลี่ยน ID ผู้ต้องขัง เป็น inmateId
        const sql = `SELECT i.id, ic.inmate_id , p.prefixes_nameTh , i.firstname , i.lastname,
            i.inmate_photo_url,
            (SELECT COUNT(*) FROM visit_booking AS vb JOIN visit_slot AS vs ON vb.slot_id = vs.id
            WHERE vb.relative_user_id = ui.userId 
            AND vb.inmate_id = i.id 
            AND vb.status IN ('PENDING','APPROVED','CHECKED_IN','COMPLETED')
            AND YEAR(vs.visit_date) = ?
            AND MONTH(vs.visit_date) = ?
            ) AS Quota_Used

            FROM user_inmate_relationship AS ui
            JOIN inmate AS i ON ui.inmateId = i.id
            LEFT JOIN prefixes AS p ON i.prefixeID = p.id_prefixes 
            LEFT JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            WHERE ui.userId = ?`

        const [myInmate] = await db.execute(sql,[year,month,myUserId]) 


        if (myInmate.length === 0){
            res.status(200).json({
                message : 'ไม่มีข้อมูลผู้ต้องขังที่เกี่ยวข้อง',
                data : []
            })
        }
        const inmateList = myInmate.map(item => {
            const used = item.Quota_Used;
            const remaining = Math.max(0, Max_Quota_Per_Month - used)

            return {
                inmate_id : item.id,
                inmate_number : item.inmate_id,
                inmate_photo_url : item.inmate_photo_url,
                fullname : (item.prefixes_nameTh || '') + ' ' + item.firstname + ' ' + item.lastname, 
                Quota : {
                    remaining : remaining,
                    is_full : (remaining === 0)
                }


            }


            

        })
        return res.status(200).json({
            message : 'ข้อมูลผู้ต้องขังที่เกี่ยวข้อง',
            data : inmateList
        })


    }catch (error){
        console.log(error) 
        res.status(500).json({message: 'Internal Server Error'})
    }

})



app.get('/slot/monthly', checkAPI_key,checkAuth, async (req,res) => {
    try{
        const myUserId = req.user.userId
        const {year,month,exclude_booking_id} = req.query
        let booked_select_sql = 'SUM(vs.current_booking)';
        let queryParams = []

        if (!year || !month){
            throw new ValidationError("กรุณาระบุ year และ month")
        }

        if (exclude_booking_id){
            console.log("มีการส่ง exclude_booking_id มา: ", exclude_booking_id)
            booked_select_sql = `SUM(vs.current_booking) - (SELECT COUNT(*) FROM visit_booking AS vb 
            JOIN visit_slot AS sub_vs ON vb.slot_id = sub_vs.id
            WHERE vb.id = ? AND DATE(sub_vs.visit_date) = MAX(DATE(vs.visit_date)) AND vb.status NOT IN('CANCELLED','REJECTED')
            
            )`
            queryParams.push(exclude_booking_id)
        }
        queryParams.push(year,month)

        const [rows] = await db.execute(`
                SELECT DATE(vs.visit_date) AS visit_date , SUM(vs.capacity) AS total_capacity, ${booked_select_sql} AS total_booked, MAX(vs.status) AS status
                FROM visit_slot AS vs
                WHERE YEAR(vs.visit_date) = ? AND MONTH(vs.visit_date) = ?
                GROUP BY DATE(vs.visit_date)
                ORDER BY DATE(vs.visit_date) ASC
            `, queryParams)
            if (rows.length === 0){
            return res.status(404).json({message: 'ไม่พบข้อมูลช่องเวลาการเยี่ยมชมในเดือนและปีที่ระบุ'})
        }

        console.log("ผลลัพธ์การดึงข้อมูลช่องเวลาการเยี่ยมชมรายเดือน: ", rows)
        const calendarData = {}

        rows.forEach(row => {
            // แปลงวันที่เป็น String '2024-11-20'
            
            const d = new Date(row.visit_date)
            const yyyy = d.getFullYear()
            const mm = String(d.getMonth() + 1).padStart(2, '0') 
            const dd = String(d.getDate()).padStart(2, '0')
        

            const dateKey = `${yyyy}-${mm}-${dd}`
            const thaiDate = d.toLocaleDateString('th-TH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            let status = 'AVAILABLE';

            if (Number(row.total_booked) >= Number(row.total_capacity)) {
                
                status = 'FULL';
            } else if (row.status === 'CLOSED') {
                status = 'CLOSED';
            }
            calendarData[dateKey] = {
                status: status,
                
                seats_left: Math.max(0, Number(row.total_capacity) - Number(row.total_booked))
            };
        });

        res.status(200).json({
            message : 'ข้อมูลช่องเวลาการเยี่ยมชมรายเดือน',
            data : calendarData
        })
    }catch (error){
        console.log(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }
})
app.get('/slots/preview', checkAPI_key,checkAuth, async (req,res) => {
    try{
        const {inmate_id,date} = req.query
        const myUserId = req.user.userId
        if (!inmate_id || !date){   
            throw new ValidationError("กรุณาระบุ inmate_id และ date")
        }



        const [rows] = await db.execute(`
            SELECT ic.inmate_id , p.prefixes_nameTh, i.firstname ,i.lastname ,i.inmate_photo_url ,i.allow_visit
            FROM user_inmate_relationship AS ui 
            JOIN inmate AS i ON ui.inmateId = i.id 
            LEFT JOIN prefixes as p ON i.prefixeID =  p.id_prefixes
            JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            WHERE ui.userId = ? AND ui.inmateId = ? AND ic.status = 'ACTIVE'

            
            `,[myUserId,inmate_id])
        if (rows.length === 0){
            throw new ValidationError("ไม่พบข้อมูลผู้ต้องขังที่เกี่ยวข้องหรือผู้ต้องขังนี้ไม่สามารถรับการเยี่ยมชมได้")
        }
        const thaiDate = new Date(date).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const inmateData = rows[0]
        const isAllowVisit = (inmateData.allow_visit === 1)
        return res.status(200).json({
            message : 'ข้อมูลพรีวิวการจองช่องเวลาการเยี่ยมชม',
            data : {
                visit_date : thaiDate,
                inmate_id : inmateData.inmate_id,
                inmate_photo_url : inmateData.inmate_photo_url,
                prefix_name : inmateData.prefixes_nameTh,
                inmate_firstname : inmateData.firstname,
                inmate_lastname : inmateData.lastname,
                allow_visit : {
                    isAllowVisit : isAllowVisit,
                    message : isAllowVisit ? 'ผู้ต้องขังนี้สามารถรับการเยี่ยมชมได้' : 'ผู้ต้องขังนี้ไม่สามารถรับการเยี่ยมชมได้ เนื่องจากมีเหตุผลบางประการ เช่น สุขภาพไม่ดี หรือ อยู่ในระหว่างการถูกลงโทษทางวินัย'
                }
             }
        })
        

    }catch (error){
            console.log(error)
            if (error instanceof ValidationError){
                return res.status(error.statusCode).json({message: error.message})
            }
            return res.status(500).json({message: 'Internal Server Error'})

        }
    }
    )


app.get('/slots', checkAPI_key,checkAuth, async (req,res) => {
    // ควรแยกหญิงชาย กับ จำนวนที่ญาติจองได้แต่ละเดือน 
    // ต้องจองล่วงหน้าได้สูงสุดกี่วัน
    // จองวันเดียวกันไม่ได้
    // Zoom ต้องสร้าง link ใหม่
    // zoom สามารถจองเวลาเดียวกันได้ไหม
    
    try{
        const {date, type,exclude_booking_id} = req.query
        if (!date || !type){
            throw new ValidationError("กรุณาระบุ date และ type")
        }
        let current_slot_id = null;
        let sql = `SELECT v.id,v.visit_date, 
            TIME_FORMAT(v.starts_at, '%H:%i') AS starts_at, 
            TIME_FORMAT(v.ends_at, '%H:%i') AS ends_at, 
            v.capacity AS capacity, 
            v.current_booking AS current_booking, 
            v.status AS status,
            
            d.device_name AS device_name ,d.platforms AS platforms 
            FROM visit_slot AS v 
            JOIN devices AS d ON v.device_id = d.id 
            
            WHERE v.visit_date = ? AND d.platforms = ? AND v.current_booking <= v.capacity 
            ORDER BY d.device_name,v.starts_at ASC;
            `
        let queryParams = [date,type]
        if (exclude_booking_id){
            const [excludeInfo] = await db.execute(`SELECT slot_id FROM visit_booking WHERE id = ? AND status NOT IN('CANCELLED','REJECTED')`,[exclude_booking_id])
            if (excludeInfo.length > 0){
                current_slot_id = excludeInfo[0].slot_id
            }
        }
        
        
        const [rows] = await db.execute(sql, queryParams)
            //console.log("ผลลัพธ์การดึงข้อมูลช่องเวลาการเยี่ยมชมรายวัน: ", rows)
            if (rows.length === 0){
                return res.status(404).json({message: 'ไม่พบช่องเวลาการเยี่ยมชมในวันที่ระบุ'})
            }
            const deviceName_Set = {}
            rows.forEach(row => {
                const time_label = `${row.starts_at} - ${row.ends_at}`;
                const deviceName = row.device_name;
                
                const capacity = Number(row.capacity);
                const current_booking = Number(row.current_booking);

                let status = 'AVAILABLE';
                
                if (row.status === 'CLOSED'){
                    status = 'CLOSED';
                }else if(row.id === current_slot_id){
                    status = 'CURRENT';

                }
                else if(row.status === 'FULL' || current_booking >= capacity){
                    status = 'FULL';
                }
                
                const slotData = {
                    slot_id : row.id,
                    time: time_label,
                    status : status,
                    
                }

                if (!deviceName_Set[deviceName]){
                    deviceName_Set[deviceName] = {
                        deviceName: deviceName,
                        slots: []
                    }
                }
                deviceName_Set[deviceName].slots.push(slotData);
                //ทำถึง status แล้ว
            })
            
            console.log("ข้อมูลช่องเวลาการเยี่ยมชมที่จัดกลุ่มตามอุปกรณ์: ", Object.values(deviceName_Set))
            res.status(200).json({
                message : 'ข้อมูลช่องเวลาการเยี่ยมชมรายวัน',
                visit_date : date,
                data : Object.values(deviceName_Set)
            })
    }catch(error){
        console.log(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }
})

app.get('/booking-preview', checkAPI_key,checkAuth, async (req,res) => {
    try{
        const userId = req.user.userId
        const {inmate_id,slot_id} = req.query
        if (!slot_id || !inmate_id){
            throw new ValidationError("กรุณาระบุ slot_id และ inmate_id")
        }
        const [slotRows] = await db.execute(`
            SELECT u.id_card AS visitor_id_card, u.firstname AS visitor_firstname, u.lastname AS visitor_lastname

            , i.id_card AS inmate_id_card, i.firstname AS inmate_firstname, i.lastname AS inmate_lastname

            ,v.id,v.visit_date AS visit_date, 
            TIME_FORMAT(v.starts_at, '%H:%i') AS starts_at, 
            TIME_FORMAT(v.ends_at, '%H:%i') AS ends_at,

            d.device_name AS device_name ,

            (SELECT COUNT(*) FROM visit_booking AS vb JOIN visit_slot AS vs ON vb.slot_id = vs.id 
            JOIN user_inmate_relationship AS ui ON vb.relative_user_id = ui.userId AND vb.inmate_id = ui.inmateId
            WHERE vb.relative_user_id = u.userId AND
            vb.inmate_id = i.id AND 
            
            vb.status IN ('PENDING','APPROVED','CHECKED_IN','COMPLETED')
            AND YEAR(vs.visit_date) = YEAR(v.visit_date)
            AND MONTH(vs.visit_date) = MONTH(v.visit_date)
            ) AS Quota_Used


            FROM visit_slot AS v
            JOIN user AS u ON u.userId = ?
            JOIN inmate AS i ON i.id = ?
            JOIN devices AS d ON v.device_id = d.id
            WHERE v.id = ? ;
        `, [userId, inmate_id, slot_id])

        if (slotRows.length === 0){
            throw new ValidationError("ไม่พบข้อมูลช่องเวลาการเยี่ยมชมที่ระบุ")
        }
        const data = slotRows[0]
        const [existingBooking] = await connection.execute(`
            SELECT vb.id 
            FROM visit_booking vb
            JOIN visit_slot vs ON vb.slot_id = vs.id
            WHERE vb.inmate_id = ? 
              AND vs.visit_date = ? 
              AND vb.status IN ('PENDING', 'APPROVED')
        `, [inmate_id, data.visit_date]);

        if (existingBooking.length > 0) {
            // 🛑 ถ้าเจอว่ามีคิวอยู่แล้ว ให้เด้ง Error กลับไปหาหน้าเว็บเลย!
            return res.status(400).json({ 
                message: "ผู้ต้องขังรายนี้มีคิวเยี่ยมในวันที่เลือกแล้ว (สิทธิ์การเยี่ยม 1 ครั้ง/วัน) กรุณาเลือกวันอื่นครับ" 
            });
        }

        console.log("quota " ,data.Quota_Used)


        if (data.Quota_Used >= 2){ 
            throw new ValidationError("คุณได้ใช้สิทธิ์การจองช่องเวลาการเยี่ยมชมสำหรับผู้ต้องขังนี้ครบตามโควต้าประจำเดือนแล้ว")
        }
        
        console.log("ผลลัพธ์การดึงข้อมูลช่องเวลาการเยี่ยมชมสำหรับพรีวิวการจอง: ", slotRows[0])
        

        const thaiDate = new Date(data.visit_date).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
        const BookingPayload = {
            slot_id: data.id,
            inmate_id: inmate_id,
            user_id: userId,
            type : 'BOOKING_PREVIEW'

        }
        const bookingToken = jwt.sign(BookingPayload, process.env.JWT_SECRET, {expiresIn : '10m'})

        res.status(200).json({
            message : 'ข้อมูลพรีวิวการจองช่องเวลาการเยี่ยมชม',
            bookingToken: bookingToken,
            data : {
                visitor : {
                    id_card : data.visitor_id_card,
                    fullname : data.visitor_firstname + ' ' + data.visitor_lastname
                },
                inmate : {
                    id_card : data.inmate_id_card,
                    fullname : data.inmate_firstname + ' ' + data.inmate_lastname
                },
                slot : {
                    slot_id : data.id,
                    visit_date : thaiDate ,
                    time : data.starts_at + ' - ' + data.ends_at,
                    device_name : data.device_name
                }
            }
        })

        
    }catch (error){
        console.log(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }
        })

app.post('/booking', checkAPI_key,checkAuth, async (req,res) => {
    let connection;
    try{
        const {bookingToken} = req.body
        if (!bookingToken){
            throw new ValidationError("กรุณาผ่านขั้นตอนการพรีวิวการจองก่อน")
    
        }
        let decoded;
        try{
            decoded = jwt.verify(bookingToken, process.env.JWT_SECRET)
        }catch(err){
            throw new ValidationError("Token สำหรับการจองหมดอายุหรือไม่ถูกต้อง")

        }
        if (decoded.type !== 'BOOKING_PREVIEW'){
            throw new ValidationError("รูปแบบ Token ไม่ถูกต้อง")
        }

        
        const userId = decoded.user_id
        const slot_id = decoded.slot_id
        const inmate_id = decoded.inmate_id
        
        if (!slot_id || !inmate_id || !userId){
            throw new ValidationError("กรุณาระบุ slot_id ,userId และ inmate_id")
        }
        connection = await db.getConnection()
        await connection.beginTransaction()

        //ตรวจสอบ slot_id ว่ายังว่างไหม
        const [slotRows] = await connection.execute(`
            SELECT s.id,s.starts_at,s.ends_at, s.visit_date,s.current_booking, s.capacity,s.status,b.relative_user_id,b.status AS booking_status,d.platforms
            FROM visit_slot AS s LEFT JOIN visit_booking AS b ON s.id = b.slot_id AND b.relative_user_id = ? AND b.status NOT IN ('CANCELLED','REJECTED') JOIN devices AS d ON s.device_id = d.id
            WHERE s.id = ?  FOR UPDATE;
        `, [userId,slot_id]);
        

        
            
        if (slotRows.length === 0){
            throw new ValidationError("ไม่พบข้อมูลช่องเวลาการเยี่ยมชมที่ระบุ")
        }
        const slotData = slotRows[0]
        if (slotData.status === 'CLOSED'){
            throw new ValidationError("ช่องเวลาการเยี่ยมชมนี้ปิดรับการจองแล้ว")
        }
        if (slotData.booking_status && slotData.booking_status !== 'CANCELLED' && slotData.booking_status !== 'REJECTED'){
            throw new ValidationError("คุณมีการจองช่องเวลาการเยี่ยมชมนี้อยู่แล้ว")
        }

        console.log("ข้อมูลช่องเวลาการเยี่ยมชมที่ตรวจสอบการจอง: ", slotData)
        if (slotData.current_booking >= slotData.capacity){
            throw new ValidationError("ช่องเวลาการเยี่ยมชมนี้เต็มแล้ว")
        }
        console.log("ช่องเวลาการเยี่ยมชมนี้ยังมีที่ว่างอยู่ สามารถทำการจองได้",slotData.platforms)
        const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
        const bk_type = slotData.platforms === 'ZOOM' ? 'ZM' : slotData.platforms === 'WEBRTC' ? 'RTC' : 'LN';
        let bookingCode = `${bk_type}-${randomStr}`;
        
        let meeting_id = null;
        let meeting_password = null;
        let join_url = null;
        let start_url = null;

        

        if (slotData.platforms === 'ZOOM'){
            const d = new Date(slotData.visit_date)
            const day = String(d.getDate()).padStart(2, '0')
            const month = String(d.getMonth() + 1).padStart(2, '0')
            const year = d.getFullYear()
            const time = slotData.starts_at 
            console.log("time = ",time)
            
            const formatedDate = `${year}-${month}-${day}T${time}`
            const topic = `การเยี่ยมชมผู้ต้องขัง ${inmate_id} ในวันที่ ${formatedDate}`
            console.log("วันที่และเวลาที่ฟอร์แมตสำหรับการสร้างการประชุม Zoom: ", formatedDate)
            const zoomMeetingLink = await createMeeting(topic,formatedDate, 20)
            
                meeting_id = zoomMeetingLink.meeting_id
                meeting_password = zoomMeetingLink.password
                join_url = zoomMeetingLink.join_url
                start_url = zoomMeetingLink.start_url
            
        }
        
    //business logic ตรวจสอบการจองซ้ำ ยังไม่ได้ทำ
    


    const [insertResult] = await connection.execute(`
        INSERT INTO visit_booking (slot_id,inmate_id,relative_user_id,meeting_id,meeting_password,join_url,starts_url,booking_code)
        VALUES (?,?,?,?,?,?,?,?)`, [slot_id, inmate_id, userId,meeting_id,meeting_password,join_url,start_url,bookingCode])

    if (insertResult.affectedRows === 0){
        throw new ValidationError("ไม่สามารถสร้างการจองได้")}
    const [updateResult] = await connection.execute(`
        UPDATE visit_slot SET current_booking = current_booking + 1 WHERE id = ?
        `,[slot_id]
        )
    await connection.commit()
    res.status(201).json({
        message : 'การจองช่องเวลาการเยี่ยมชมสำเร็จ',
        booking_id : insertResult.insertId,
        booking_code : bookingCode,


    })

    }catch (error){
        console.log(error)
        if (connection){
            try{
                await connection.rollback()
            }catch (err){
                console.error('Error during rollback:', err)
            }
        }
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }finally{
        if (connection){
        try{
            connection.release()
        }
        catch (err){
            console.error('Error during release:', err)
        }}
    }
})

app.get('/my-booking', checkAPI_key,checkAuth, async (req,res) => {

    try{
        const userId = req.user.userId
        const [rows] = await db.execute(`
            SELECT vb.id AS booking_id,vb.status AS status,p.prefixes_nameTh,
            ic.inmate_id AS inmate_number,
            i.firstname AS firstname,i.lastname AS lastname,
            vb.slot_id AS slot_id,vs.visit_date AS visit_date, 
            TIME_FORMAT(vs.starts_at, '%H:%i') AS starts_at, 
            TIME_FORMAT(vs.ends_at, '%H:%i') AS ends_at,
            d.device_name,
            d.platforms,
            vb.join_url,vb.booking_code

            FROM visit_booking AS vb
            JOIN visit_slot AS vs ON vb.slot_id = vs.id
            JOIN inmate AS i ON vb.inmate_id = i.id
            LEFT JOIN prefixes AS p ON i.prefixeID = p.id_prefixes
            JOIN devices AS d ON vs.device_id = d.id
            LEFT JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            WHERE vb.relative_user_id = ?
            AND vb.status IN ('PENDING','APPROVED','CHECKED_IN')
            ORDER BY vs.visit_date DESC, vs.starts_at DESC

            `,[userId])
            console.log("ผลลัพธ์การตรวจสอบการจองช่องเวลาการเยี่ยมชมที่มีอยู่: ", rows)
            
            if (rows.length === 0){
                return  res.status(200).json({
                    message : 'ไม่มีการจองช่องเวลาการเยี่ยมชมที่มีอยู่',
                    data : []
                })
            }
            const lineOaLink = process.env.LINE_OA_ID || '@171ihkfk'

            const bookingInfo = rows.map(row => {
                let actionUrl = null
                const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
                if(row.platforms === 'ZOOM'){
                    actionUrl = row.join_url
                }else if (row.platforms === 'LINE'){
                    const raw_message = `เวลา:${row.starts_at}-ชื่อ:${row.firstname}-รหัสการจอง:${row.booking_code}`
                    const encoded_message = encodeURIComponent(raw_message)
                    actionUrl = `https://line.me/R/oaMessage/${lineOaLink}/?text=${encoded_message}`
                }else if (row.platforms === 'WEBRTC'){
                    actionUrl = `https://prison-visit-booking.duckdns.org/front.html?room=${row.booking_code}`
                }

        return {
            booking_id : row.booking_id,
            status : row.status,
            inmate_id : row.inmate_number,
            inmate_fullname : `${row.prefixes_nameTh || ' '} ${row.firstname} ${row.lastname}`,
            date : thaiDate,
            time : `${row.starts_at} - ${row.ends_at}`,
            device_name : row.device_name,
            device_platform : row.platforms,
            bookingCode : row.booking_code,
            link : actionUrl,
            
        }
            })
            res.status(200).json({
                message : 'ข้อมูลการจองที่มีอยู่',
                total : rows.length,
                data : bookingInfo
            })
            
            
    }catch (error){
        console.log(error)
        res.status(500).json({message: 'Internal Server Error'})
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        

    }
})

app.get('/my-booking/history',checkAPI_key,checkAuth, async (req,res) => {

    try{
        const userId = req.user.userId
        

        const [rows] = await db.execute(`
            SELECT vb.id, vs.visit_date, vs.starts_at, vs.ends_at,vb.status ,
            ic.inmate_id,p.prefixes_nameTh, i.firstname, i.lastname,d.device_name

            FROM visit_booking AS vb 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id
            JOIN inmate AS i ON vb.inmate_id = i.id
            LEFT JOIN prefixes AS p ON i.prefixeID = p.id_prefixes
            JOIN devices AS d ON vs.device_id = d.id
            JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            WHERE vb.relative_user_id = ? AND
            vb.status IN ('CANCELLED','COMPLETED','REJECTED')
            ORDER BY vs.visit_date DESC, vs.starts_at DESC


            `,[userId])
            console.log("ผลลัพธ์การตรวจสอบประวัติการจองช่องเวลาการเยี่ยมชม: ", rows)
            if (rows.length === 0){
                return res.status(200).json({
                    message : 'ไม่มีประวัติการจองช่องเวลาการเยี่ยมชม',
                    data : []
                })
            }
            const bookingHistory = rows.map(row => {
                const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'}

                )
                return {
                    booking_id : row.id,

                    inmate_info : {
                        prefixe : row.prefixes_nameTh || ' ',
                        firstname : row.firstname,
                        lastname : row.lastname,
                        inmate_id : row.inmate_id,
                    },
                    booking_info : {
                        date : thaiDate,
                        time : `${row.starts_at} - ${row.ends_at}`,
                        device_name : row.device_name,
                        status : row.status
                    }


                }
            })
            res.status(200).json({
                message : 'ประวัติการจองช่องเวลาการเยี่ยมชม',
                data : bookingHistory
            })


            
            
    }catch (error){
        console.log(error)
        
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})

}}
)

// app.get('/booking/:id/cancel-preview',checkAPI_key,checkAuth,async (req,res) => {
//     try{
//         const userId = req.user.userId
//         const booking_id = req.params.id

//         const [rows] = await db.execute(`
//             SELECT vb.id AS booking_id,ic.inmate_id AS inmate_number, 
//             i.firstname AS inmate_firstname, i.lastname AS inmate_lastname,
//             vs.visit_date ,TIME_FORMAT(vs.starts_at, '%H:%i') AS starts_at,
//             TIME_FORMAT(vs.ends_at, '%H:%i') AS ends_at,
//             d.device_name
//             FROM visit_booking AS vb 
//             JOIN visit_slot AS vs ON vb.slot_id = vs.id
//             JOIN inmate AS i ON vb.inmate_id = i.id
//             `)

//     }
// })


app.put('/booking/:id/cancel', checkAPI_key,checkAuth, async (req,res) => {
    let connection;
    try {
        const user_id = req.user.userId
        const booking_id = req.params.id
        const {reason} = req.body
        

        //ตรวจสอบการจอง
        connection = await db.getConnection()
        await connection.beginTransaction()


        const [bookingRows] = await connection.execute(`
            SELECT vb.id, vb.slot_id, vb.status,vb.meeting_id, vs.visit_date
            FROM visit_booking AS vb
            JOIN visit_slot AS vs ON vb.slot_id = vs.id
            WHERE vb.id = ? AND vb.relative_user_id = ? AND vb.status NOT IN ('CANCELLED','COMPLETED') FOR UPDATE;
        `, [booking_id, user_id])

            
        if (bookingRows.length === 0){
            throw new ValidationError("ไม่พบการจองที่ระบุ")
        }

        const bookingData = bookingRows[0]
        console.log("ข้อมูลการจองที่ตรวจสอบ: ", bookingData)
        const today = new Date()
        today.setHours(0,0,0,0)
        const visitDate = new Date(bookingData.visit_date)
        visitDate.setHours(0,0,0,0)
        const timeDiff = visitDate.getTime() - today.getTime()
        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24))

        if (diffDays <= 1){
            throw new ValidationError("ไม่สามารถยกเลิกการจองได้เนื่องจากเหลือเวลาน้อยกว่า 1 วันก่อนวันเยี่ยมชม")
        }
        const userNote = `ยกเลิกโดยผู้ใช้: ${reason || 'ไม่ระบุเหตุผล'}`
        
        const [updateResult] = await connection.execute(`
            UPDATE visit_booking SET status = 'CANCELLED', note = ?
            WHERE id = ? AND relative_user_id = ? 
            
            `,[userNote, booking_id, user_id])
        
            if (updateResult.affectedRows === 0){
                throw new ValidationError("ไม่สามารถยกเลิกการจองได้")
            }
            if(bookingData.meeting_id){
            deleteZoomMeeting(bookingData.meeting_id)
        }
        
        const [currentBookingRows] = await connection.execute(`
            UPDATE visit_slot SET current_booking = current_booking - 1
            WHERE id = ? AND current_booking > 0
            
            `,[bookingData.slot_id])

        await connection.commit()
        res.status(200).json({
            message : 'ยกเลิกการจองสำเร็จ',
        })

    }catch (error){
        console.log(error)
        if(connection){
            await connection.rollback()
        }
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
        

    }finally{
        if (connection){
            connection.release()
        }
    }
    


})



app.get('/booking/:id/reschedule', checkAPI_key,checkAuth, async (req,res) => {
    try{
        const user_id = req.user.userId
        
        const booking_id = req.params.id
        const todayTime = new Date().toLocaleDateString('en-CA', {timeZone : 'Asia/Bangkok'})


        const [bookingRows] = await db.execute(`
            SELECT ic.inmate_id,vb.id AS booking_id,i.firstname AS inmate_firstname, i.lastname AS inmate_lastname,vs.visit_date, TIME_FORMAT(vs.starts_at,'%H:%i') AS starts_at, TIME_FORMAT(vs.ends_at,'%H:%i') AS ends_at
            FROM visit_booking AS vb
            JOIN inmate AS i ON vb.inmate_id = i.id
            JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            JOIN visit_slot AS vs ON vb.slot_id = vs.id

            WHERE vb.id = ? AND vb.relative_user_id = ? AND vb.status NOT IN ('CANCELLED','COMPLETED')
            AND ic.status = 'ACTIVE' AND ic.release_date > ?

            `,[booking_id, user_id, todayTime])
            
        if (bookingRows.length === 0){
            throw new ValidationError("ไม่พบการจองที่ระบุหรือไม่สามารถเปลี่ยนรอบการเยี่ยมชมได้")
        }
        const bookingData = bookingRows[0]
        
        const thaiDate = new Date(bookingData.visit_date).toLocaleDateString('th-TH',{
            year : 'numeric',
            month : 'long',
            day : 'numeric'
        })

        

        const today = new Date()
        const visitDate = new Date(bookingData.visit_date)
        const timeDiff = visitDate.getTime() - today.getTime()
        
        const diffHours = Math.ceil(timeDiff / (1000 * 3600))
        
        if (diffHours < 24){  
            throw new ValidationError("ไม่สามารถเปลี่ยนรอบการเยี่ยมชมได้เนื่องจากเหลือเวลาน้อยกว่า 1 วันก่อนวันเยี่ยมชม")
        }
        console.log("ข้อมูลการจองที่ตรวจสอบสำหรับการเปลี่ยนรอบการเยี่ยมชม: ", bookingData)
        return res.status(200).json({
            message : 'ข้อมูลพรีวิวการเปลี่ยนรอบการเยี่ยมชม',
            data : {
                old_booking_id : bookingData.booking_id,
                old_visit_date : thaiDate,
                old_time  : `${bookingData.starts_at} - ${bookingData.ends_at}`,
                inmate_number : bookingData.inmate_id,
                inmate_firstname : bookingData.inmate_firstname,
                inmate_lastname : bookingData.inmate_lastname,

            }
        })
    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message: 'Internal Server Error'})
    }
})

app.get('/booking/:id/reschedule/preview', checkAPI_key,checkAuth, async (req,res) => {

    try{
        const userId = req.user.userId
        const {new_slot_id} = req.query
        const old_id = req.params.id

        if (!new_slot_id){
            throw new ValidationError('โปรดส่ง slot_id ใหม่มาด้วย')
        }


        const [old_info] = await db.execute(`
            SELECT TIME_FORMAT(vs.starts_at, '%H:%i') AS starts_at, TIME_FORMAT(vs.ends_at, '%H:%i') AS ends_at, vs.visit_date,vb.slot_id,
            ic.inmate_id AS inmate_number,i.firstname AS inmate_firstname,i.lastname AS inmate_lastname,
            u.id_card AS visitor_idCard,u.firstname AS visitor_firstname, u.lastname AS visitor_lastname,
            d.device_name,d.platforms,
            vb.status

            FROM visit_booking AS vb JOIN inmate AS i ON vb.inmate_id = i.id 
            JOIN visit_slot AS vs ON vb.slot_id = vs.id
            JOIN incarcerations AS ic ON i.id = ic.inmate_rowID
            JOIN user AS u ON vb.relative_user_id = u.userId
            JOIN devices AS d ON vs.device_id = d.id
            WHERE vb.id = ? AND vb.relative_user_id = ?
            `,[old_id,userId])

        if (old_info.length < 1){
                throw new ValidationError('ไม่พบ')
            }      
        
        const oldInfo = old_info[0]
        if (oldInfo.slot_id === new_slot_id){
            throw new ValidationError('คิวนี้ถูกเลื่อนไปแล้วไม่สามารถเลื่อนซ้ำได้')
        }
        if (oldInfo.status === 'CANCELLED' || oldInfo.status === 'REJECTED'){
            throw new ValidationError('คิวนี้โดนยกเลิกไปแล้ว')
        }


        const oldDateTH = new Date(oldInfo.visit_date).toLocaleDateString('th-TH',{
            year : 'numeric',
            month : 'long',
            day : 'numeric'
        })

        

        const today = new Date()
        const visitDate = new Date(oldInfo.visit_date)
        const timeDiff = visitDate.getTime() - today.getTime()
        
        const diffHours = Math.ceil(timeDiff / (1000 * 3600))
        
        if (diffHours < 24){  
            throw new ValidationError("ไม่สามารถเปลี่ยนรอบการเยี่ยมชมได้เนื่องจากเหลือเวลาน้อยกว่า 1 วันก่อนวันเยี่ยมชม")
        }
        console.log("ข้อมูลการจองที่ตรวจสอบสำหรับการเปลี่ยนรอบการเยี่ยมชม: ", oldInfo)
        
        const [new_slot] = await db.execute(`SELECT vs.visit_date,TIME_FORMAT(vs.starts_at,'%H:%i') AS starts_at,TIME_FORMAT(vs.ends_at,'%H:%i') AS ends_at,vs.status,
            vs.current_booking,vs.capacity,
            d.device_name,d.platforms
            FROM visit_slot AS vs JOIN devices AS d ON vs.device_id = d.id
            WHERE vs.id = ?
            
            `,[new_slot_id])
        if (new_slot[0].length === 0){
            throw new ValidationError('ไม่พบรอบการจองนี้')
        }
        const newSlot = new_slot[0]

        
        if (newSlot.status === 'CLOSED'){
            throw new ValidationError('รอบการจองนี้ถูกปิด')
        }
        if (newSlot.status === 'FULL' || Number(newSlot.current_booking) >= Number(newSlot.capacity) ){
            throw new ValidationError('รอบการจองนี้ถูกจองแล้ว')
        }
        const newDateTH = new Date(newSlot.visit_date).toLocaleDateString('th-TH',{
            year : 'numeric',
            month : 'long',
            day : 'numeric'
        })
        const payload = {
            action : 'RESCHEDULE',
            userId : userId,
            old_booking_id : old_id,
            new_slot_id : new_slot_id

        };
        const rescheduleToken = jwt.sign(payload, process.env.JWT_SECRET,{expiresIn : '5m'});
        res.status(200).json({
            message : 'ข้อมูลพรีวิวการเลื่อนการจอง',
            reschedule_token : rescheduleToken,
            data : {
                inmate_info : {
                    inmate_number : `${oldInfo.inmate_number}`,
                    inmate_firstname : `${oldInfo.inmate_firstname}`,
                    inmate_lastname : `${oldInfo.inmate_lastname}`
                },
                oldTime : {
                    date : `${oldDateTH}`,
                    start_time : `${oldInfo.starts_at}`,
                    end_time : `${oldInfo.ends_at}`,
                    device_name : `${oldInfo.device_name}` ,
                    platform : `${oldInfo.platforms}`
                },
                newTime :{
                    date : `${newDateTH}`,
                    start_time : `${newSlot.starts_at}`,
                    end_time : `${newSlot.ends_at}`,
                    device_name : `${newSlot.device_name}` ,
                    platform : `${newSlot.platforms}`
            }
        }
    })


    }catch(error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message: 'Internal Server Error'})
    }

})

app.post('/booking/reschedule',checkAPI_key,checkAuth,async (req,res) => {
    let connection;
    


    
        
    try{
        const user_id = req.user.userId
        const {reschedule_token}= req.body
        if (!reschedule_token){
            throw new ValidationError('ไม่มี token')
        }
        let decodedToken;
        try{
            decodedToken = jwt.verify(reschedule_token,process.env.JWT_SECRET);
        }catch(error){
            console.error(error)
            throw new ValidationError('Token ไม่ถูกต้อง')
        }
        
        if(decodedToken.action !== 'RESCHEDULE' || decodedToken.userId !== user_id){
            throw new ValidationError('Token ไม่ถูกต้องสำหรับการเลื่อนคิว')
        }

        const old_booking_id = decodedToken.old_booking_id
        const new_slot_id = decodedToken.new_slot_id

        connection = await db.getConnection()
        await connection.beginTransaction()

        const [old] = await connection.execute(`
            SELECT vb.id,vb.slot_id ,vb.status ,vb.meeting_id,vb.booking_code,i.firstname AS inmate_firstname ,i.lastname AS inmate_lastname ,d.platforms FROM visit_booking AS vb JOIN inmate AS i ON vb.inmate_id = i.id JOIN visit_slot AS vs ON vb.slot_id = vs.id JOIN devices AS d ON vs.device_id = d.id WHERE vb.id = ? FOR UPDATE
            `,[old_booking_id])
        console.log("olde = ",old[0])
        if (old.length === 0 || old[0].status !== 'PENDING'){
            throw new ValidationError('คิวนี้ถูกยกเลิกไปแล้วไม่สามารถเลื่อนได้')
        }

        const old_slot = old[0]
        if (Number(old_slot.slot_id) === Number(new_slot_id)) {
            throw new ValidationError('คุณเลื่อนการจองนี้ไปแล้ว ไม่สามารถเลื่อนซ้ำได้')

        }


        const [newSlotRows] = await connection.execute(`
            SELECT vs.id,vs.visit_date,TIME_FORMAT(vs.starts_at,'%H:%i') AS starts_at,TIME_FORMAT(vs.ends_at,'%H:%i') AS ends_at,vs.capacity,vs.current_booking,vs.status,d.id AS device_id,d.platforms FROM visit_slot AS vs JOIN devices AS d ON vs.device_id = d.id WHERE vs.id = ? FOR UPDATE
            
            `,[new_slot_id])

        if (newSlotRows.length === 0 ||newSlotRows[0].status != 'OPEN'||Number(newSlotRows[0].current_booking) >= Number(newSlotRows[0].capacity)){
            throw new ValidationError('ขออภัย รอบจองนี้พึ่งเต็มไปเมื่อซักครู่นี้')
        }
        const newSlot = newSlotRows[0]

        const oldPlatforms = old_slot.platforms
        const newPlatforms = newSlot.platforms

        let current_booking_code = old_slot.booking_code;

        if (oldPlatforms !== newPlatforms){
            const prefix = newPlatforms === 'ZOOM' ? 'ZM' : slotData.platforms === 'WEBRTC' ? 'RTC' : 'LN';

            const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
            
            // อัปเดตตัวแปรเป็นรหัสใหม่ (เช่น ZM-X9Y8Z7)
            current_booking_code = `${prefix}-${randomString}`;


        }

        
        
        
        let new_meeting_id = null;
        let new_meeting_password = null;
        let new_join_url = null;
        let new_start_url = null;
        
        
        if (newSlot.platforms === 'ZOOM'){
            const d = new Date(newSlot.visit_date)
            const day = String(d.getDate()).padStart(2, '0')
            const month = String(d.getMonth() + 1).padStart(2, '0')
            const year = d.getFullYear()
            const time = newSlot.starts_at 
            console.log("time = ",time)
            
            const formatedDate = `${year}-${month}-${day}T${time}`
            const topic = `การเยี่ยมชมผู้ต้องขัง ${old_slot.inmate_firstname} ${old_slot.inmate_lastname} ในวันที่ ${formatedDate}`
            console.log("วันที่และเวลาที่ฟอร์แมตสำหรับการสร้างการประชุม Zoom: ", formatedDate)
            const zoomMeetingLink = await createMeeting(topic,formatedDate, 20)
            
                new_meeting_id = zoomMeetingLink.meeting_id
                new_meeting_password = zoomMeetingLink.password
                new_join_url = zoomMeetingLink.join_url
                new_start_url = zoomMeetingLink.start_url
            
            if(old_slot.meeting_id){
                deleteZoomMeeting(old_slot.meeting_id)
            }
        }
        await connection.execute(`UPDATE visit_booking SET slot_id = ?,
                meeting_id = ?,
                meeting_password = ?,
                join_url = ?,
                starts_url = ?,
                booking_code = ? WHERE id = ?`,
                [newSlot.id,
                    new_meeting_id,
                    new_meeting_password,
                    new_join_url,
                    new_start_url,
                    current_booking_code,
                    old_slot.id
                ]
                )

        const [oldUpdate] = await connection.execute(`UPDATE visit_slot SET current_booking = current_booking - 1 WHERE id = ? AND current_booking > 0`,[old_slot.slot_id])
        if (oldUpdate.affectedRows === 0){
            throw new ValidationError('พบปัญหาในการคืนคิวเดิม')
        }
        const [newUpdate] = await connection.execute(`UPDATE visit_slot SET current_booking = current_booking + 1 WHERE id = ? AND current_booking < capacity`,[newSlot.id])

        if (newUpdate.affectedRows === 0) {
            // ถ้า affectedRows = 0 แปลว่าเงื่อนไข current_booking < capacity ไม่เป็นจริง (คิวเต็มแล้ว!)
            throw new ValidationError("ขออภัย คิวใหม่เต็มแล้วในขณะที่คุณกำลังทำรายการ");
        }

        await connection.commit();
        res.status(200).json({
            message: 'เลื่อนการจองสำเร็จ',
            new_booking_code: current_booking_code
        })
    }catch(error){
        console.error(error)
        if (connection){
            try { await connection.rollback(); } catch (err) { console.error(err); }
        }
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message: 'Internal Server Error'})
    }finally{
        if (connection){
            try { await connection.release(); } catch (err) { console.error(err); }
        }
    }



})

// app.get('/admin/inmates',checkAPI_key,checkAuth, async (req,res) => {
//     try{
//         const [rows] = await db.execute(``
//     }


// ==========================================
// 📜 API สำหรับเจ้าหน้าที่/แอดมิน: ดูประวัติการเยี่ยมย้อนหลัง (Visit History)
// ==========================================
app.get('/admin/visit-history', checkAPI_key, checkAdminAuth, checkRole(['SUPER_ADMIN', 'REGISTRAR', 'VISITATION']), async (req, res) => {
    try {
        // รับค่า Filter (เผื่อเจ้าหน้าที่อยากค้นหาประวัติเฉพาะคน)
        const { inmate_id, relative_id, start_date, end_date } = req.query;

        // 🌟 กรองเอาเฉพาะสถานะที่ "จบกระบวนการแล้ว" เท่านั้น
        let whereConditions = ["vb.status IN ('COMPLETED', 'NO_SHOW', 'CANCELLED', 'REJECTED')"];
        let queryParams = [];

        // 1. ค้นหาประวัติของนักโทษคนใดคนหนึ่ง
        if (inmate_id) {
            whereConditions.push('vb.inmate_id = ?');
            queryParams.push(inmate_id);
        }
        // 2. ค้นหาประวัติของญาติคนใดคนหนึ่ง
        if (relative_id) {
            whereConditions.push('u.id_card = ?');
            queryParams.push(relative_id);
        }
        // 3. ค้นหาตามช่วงเวลา (เช่น ดูประวัติของเดือนที่แล้ว)
        if (start_date && end_date) {
            whereConditions.push('vs.visit_date BETWEEN ? AND ?');
            queryParams.push(start_date, end_date);
        }

        let whereSQL = 'WHERE ' + whereConditions.join(' AND ');

        // 🌟 คำสั่ง SQL รวบรวมข้อมูลประวัติ (เรียงจากใหม่ไปเก่า DESC)
        const sql = `
            SELECT 
                vb.id AS booking_id,
                vb.booking_code,
                vb.status AS booking_status,
                vs.visit_date,
                vs.starts_at,
                vs.ends_at,
                d.platforms,
                u.id_card AS visitor_id_card,
                u.userId AS relative_id,
                u.firstname AS visitor_firstname, 
                u.lastname AS visitor_lastname,
                i.id AS inmate_id,
                ic.inmate_id AS inmate_number,
                i.firstname AS inmate_firstname, 
                i.lastname AS inmate_lastname
            FROM visit_booking vb
            JOIN visit_slot vs ON vb.slot_id = vs.id
            LEFT JOIN devices d ON vs.device_id = d.id
            LEFT JOIN user u ON vb.relative_user_id = u.userId
            LEFT JOIN inmate i ON vb.inmate_id = i.id
            JOIN incarcerations ic ON i.id = ic.inmate_rowID
            ${whereSQL}
            ORDER BY vs.visit_date DESC, vs.starts_at DESC 
        `;

        const [historyRows] = await db.execute(sql, queryParams);

        // 🌟 Map แปลภาษาให้พร้อมนำไปโชว์หน้าเว็บ
        const statusMap = {
            'COMPLETED': 'เยี่ยมสมบูรณ์',
            'NO_SHOW': 'ไม่มาตามนัด',
            'CANCELLED': 'ยกเลิก',
            'REJECTED': 'ไม่อนุมัติ'
        };

        const formattedHistory = historyRows.map(row => {
            const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });

            return {
                booking_id: row.booking_id,
                visit_date: thaiDate,
                time: `${row.starts_at} - ${row.ends_at}`,
                status_en: row.booking_status,
                status_th: statusMap[row.booking_status] || row.booking_status,
                platform: row.platforms,
                inmate_name: `${row.inmate_firstname} ${row.inmate_lastname}`,
                inmate_number: row.inmate_number,
                visitor_id_card : row.visitor_id_card,
                visitor_name: `${row.visitor_firstname} ${row.visitor_lastname}`
            };
        });

        res.status(200).json({
            message: "ดึงข้อมูลประวัติการเยี่ยมย้อนหลังสำเร็จ",
            total_records: formattedHistory.length,
            data: formattedHistory
        });

    } catch (error) {
        console.error("Get Visit History Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลประวัติย้อนหลัง" });
    }
});



app.get('/admin/slots', checkAPI_key,checkAdminAuth,checkRole(['SUPER_ADMIN','REGISTRAR']),async (req,res) => {
    try{
        const {date} = req.query
        if (!date){
            throw new ValidationError("กรุณาระบุ date")
        }
        const [rows] = await db.execute(`
            SELECT i.firstname AS inmate_firstname, i.lastname AS inmate_lastname,
                u.firstname AS visitor_firstname, u.lastname AS visitor_lastname,
                vs.visit_date, TIME_FORMAT(vs.starts_at, '%H:%i') AS starts_at, TIME_FORMAT(vs.ends_at, '%H:%i') AS ends_at, d.device_name,d.platforms,

             vb.id,vb.status ,vb.starts_url ,vb.booking_code
             FROM visit_booking AS vb
             JOIN visit_slot AS vs ON vb.slot_id = vs.id
             JOIN inmate AS i ON vb.inmate_id = i.id
             JOIN user AS u ON vb.relative_user_id = u.userId
             JOIN devices AS d ON vs.device_id = d.id
             WHERE vs.visit_date = ? AND vb.status IN ('PENDING','APPROVED')
             ORDER BY vs.starts_at ASC

            
            `,[date])
            console.log("ผลลัพธ์การดึงข้อมูลช่องเวลาการเยี่ยมชมสำหรับแอดมิน: ", rows)
            const statusMap = {
                    'PENDING' : 'รอการอนุมัติ',
                    'APPROVED' : 'อนุมัติแล้ว',
                    'CHECKED_IN' : 'เช็คอินแล้ว',
                    'COMPLETED' : 'เยี่ยมชมแล้ว',
                    'CANCELLED' : 'ยกเลิกแล้ว',
                    'REJECTED' : 'ถูกปฏิเสธ'
                }
            const lineOaLink = process.env.LINE_OA_ID || '@171ihkfk'
            const bookingInfo = rows.map(row => {
                let actionUrl = null
                const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH',{
                    year : 'numeric',
                    month : 'long',
                    day : 'numeric'
                })
                if(row.platforms === 'ZOOM'){
                    actionUrl = row.starts_url
                }else if (row.platforms === 'LINE'){
                    actionUrl = `เวลา:${row.starts_at}-ชื่อ:${row.inmate_firstname}-รหัสการจอง:${row.booking_code}`
                }else if (row.platforms === 'WEBRTC'){
                    actionUrl = `https://prison-visit-booking.duckdns.org/front.html?room=${row.booking_code}`
                }

                return {
                    booking_id : row.id,
                    inmate : {
                        firstname : row.inmate_firstname,
                        lastname : row.inmate_lastname

                    },
                    visitor : {
                        firstname : row.visitor_firstname,
                        lastname : row.visitor_lastname
                    },
                    slot : {
                        booking_id : row.id,
                        visit_date : thaiDate,
                        time : `${row.starts_at} - ${row.ends_at}`,
                        device_name : row.device_name,
                        status : statusMap[row.status] || row.status,
                        device_platform : row.platforms,
                        bookingCode : row.booking_code,
                        meeting_link : actionUrl

                    }
                }
            })
            res.status(200).json({
                message : 'ข้อมูลการจองช่องเวลาการเยี่ยมชมสำหรับแอดมิน',
                total_today : rows.length,
                data : bookingInfo
            })

    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message: 'Internal Server Error'})
    }
})
app.put('/admin/slots/:id/link',checkAPI_key,checkAdminAuth,checkRole(['SUPER_ADMIN','REGISTRAR']), async (req,res) => {
    try{
        const booking_id = req.params.id
        const {meeting_link} = req.body
        if (!meeting_link){
            throw new ValidationError("กรุณาระบุ meeting_link สำหรับการอัปเดตช่องเวลาการเยี่ยมชม")
        }
        const [updateResult] = await db.execute(`
            UPDATE visit_booking SET meeting_link = ? WHERE id = ?
        `,[meeting_link || null, booking_id])
            if (updateResult.affectedRows === 0){
                throw new ValidationError("ไม่พบการจองที่ระบุหรือไม่สามารถอัปเดตลิงก์ได้")
            }
            res.status(200).json({
                message : 'อัปเดตลิงก์การเยี่ยมชมสำเร็จ',
                booking_id : booking_id,
                meeting_link : meeting_link
            })


    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message: 'Internal Server Error'})
    }
}
)
app.put('/admin/slots/:id/cancel',checkAPI_key,checkAdminAuth,checkRole(['SUPER_ADMIN','REGISTRAR']), async (req,res) => {
    let connection;
    try{
        const booking_id = req.params.id
        const {reason} = req.body 

        if (!reason || reason.trim() === ''){
            throw new ValidationError("กรุณาระบุ reason สำหรับการยกเลิกการจอง")
        }

        connection = await db.getConnection()

        await connection.beginTransaction()


        const [bookingRows] = await connection.execute(`
            SELECT slot_id,status ,meeting_id FROM visit_booking WHERE id = ? FOR UPDATE
        `,[booking_id])
            if (bookingRows.length === 0){
                throw new ValidationError("ไม่พบการจองที่ระบุ")
            }
            
            const currentStatus = bookingRows[0].status
            if (['CANCELLED','COMPLETED','REJECTED','CHECKED_IN'].includes(currentStatus)){
                throw new ValidationError("ไม่สามารถยกเลิกการจองนี้ได้เนื่องจากสถานะปัจจุบันคือ " + currentStatus)
            }
            const adminNote = 'ยกเลิกโดยแอดมิน: ' + reason
            
            const [updateResult] = await connection.execute(`
                UPDATE visit_booking SET status = 'REJECTED' ,note = ? WHERE id = ?
                `,[adminNote, booking_id])
            if (updateResult.affectedRows === 0){
                throw new ValidationError("ไม่สามารถยกเลิกการจองได้")
            }
            if(bookingRows[0].meeting_id){
            deleteZoomMeeting(bookingRows[0].meeting_id)
        }
            await connection.execute(`UPDATE visit_slot SET current_booking = current_booking - 1 WHERE id = ? AND current_booking > 0`,
                [bookingRows[0].slot_id]
            )
            await connection.commit()
            res.status(200).json({
                message : 'ยกเลิกการจองสำเร็จ',
                booking_id : booking_id
            })
                

    }catch (error){
        console.error(error)
        if (connection){
            await connection.rollback()
        }
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        return res.status(500).json({message: 'Internal Server Error'})
    }finally{
        if (connection){
            try{
                connection.release()
            }catch (err){
                console.error('Error during release:', err)
            }
        }
    }
}
)

// app.post('/admin/generate-slots',checkAPI_key,checkAuth,async(req,res) => {
//     let connection;
//     try{
//         const {year, month} = req.body
//         if (!year || !month ){
//             throw new ValidationError("กรุณาระบุ year และ month")
//         }
//         const capasity_per_slot = 1
//         const timeSlots = [
//             {starts_at : '09:00:00',end: '09:15:00',device_id : 3,allowed_gender : 'MALE'},
//             {starts_at : '10:15:00',end: '10:30:00',device_id : 3,allowed_gender : 'MALE'},
//             {starts_at : '11:15:00',end: '11:30:00',device_id : 3,allowed_gender : 'FEMALE'},
//             {starts_at : '12:15:00',end: '12:30:00',device_id : 3,allowed_gender : 'MALE'},
//             {starts_at : '13:15:00',end: '13:30:00',device_id : 3,allowed_gender : 'MALE'},
//             {starts_at : '14:15:00',end: '14:30:00',device_id : 3,allowed_gender : 'FEMALE'},

//         ]
//         //คำนวณจำนวนวันในเดือน
//         const daysInMonth = new Date(year,month,0).getDate()
//         const bulkValues = []
//         const current_booking = 0;
//         const status = 'OPEN'

//         //ลูป
//         for (let day = 1; day <= daysInMonth; day++){
//             const currentDate = new Date(year, month - 1 ,day)
//             console.log("กำลังประมวลผลวันที่: ", currentDate)
//             const dayOfWeek = currentDate.getDay()
//             if (dayOfWeek === 0 || dayOfWeek === 6){
//                 continue
//             }
//             const dateString = currentDate.toISOString().split('T')[0];
//             timeSlots.forEach(slot => {
//                 bulkValues.push([dateString, slot.starts_at, slot.end,capasity_per_slot,current_booking,status,slot.device_id,slot.allowed_gender])

//             })
//         }
//         if (bulkValues.length > 0 ){
//             connection = await db.getConnection()
//             await connection.beginTransaction()

//             await connection.query(`
//                 INSERT INTO visit_slot (visit_date,starts_at,ends_at,capacity,current_booking,status,device_id,allowed_gender) VALUES ?
                
//                 `,[bulkValues])

//             await connection.commit()
//             res.status(201).json({
//                 message : 'สร้างช่องเวลาการเยี่ยมชมสำเร็จ',
//                 total_slots_created : 'สร้างรอบของสำเร็จจำนวน' + bulkValues.length + 'รอบ',

//             })
//         }else{
//             throw new ValidationError("ไม่มีวันใดในเดือนนี้ที่สามารถสร้างช่องเวลาได้")
//         }
            
        
//     }catch (error){
//         console.log(error)
//         if (connection){
//             await connection.rollback()
//         }
//         if (error instanceof ValidationError){
//             return res.status(error.statusCode).json({message: error.message})
//         }
//         res.status(500).json({message: 'Internal Server Error'})
//     }finally{
//         if (connection){
//             try{
//                 connection.release()
//                 console.log("คืน "+connection.threadId)
//             }catch (err){
//                 console.error('Error during release:', err)
//             }
//         }
//     }
// })



