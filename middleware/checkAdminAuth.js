const jwt = require('jsonwebtoken');

const checkAdminAuth = (req, res, next) => {
    try {
        const token = req.headers.authorization.split(" ")[1]; // รับ Token จาก Header Bearer
        
        if (!token) {
            return res.status(401).json({ message: 'Authentication failed: No token provided' });
        }

        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        // 🌟 ดักจับตรงนี้! ถ้าไม่มี role แปลว่าเป็น Token ของญาติ ไม่ใช่ของเจ้าหน้าที่
        if (!decodedToken.role) {
            return res.status(403).json({ message: 'Access Denied: บัตรนี้ไม่ใช่ของเจ้าหน้าที่' });
        }
        // เก็บข้อมูลลง req.admin (เปลี่ยนชื่อจาก req.user จะได้ไม่สับสนเวลาเขียนโค้ด)
        req.admin = decodedToken; 
        next(); // ผ่านด่านที่ 1!

    } catch (error) {
        return res.status(401).json({ message: 'Authentication failed: Token หมดอายุหรือไม่ถูกต้อง' });
    }
};

module.exports = checkAdminAuth;

