// ฟังก์ชันเช็คสิทธิ์ (รับค่าเป็น Array ของ Role ที่อนุญาตให้เข้าได้)
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        // สมมติว่าตอน Login เราแนบ role มาใน Token และถอดรหัสไว้ใน req.user แล้ว
        const currentRole = req.admin.role; 

        if (!allowedRoles.includes(currentRole)) {
            return res.status(403).json({ message: "Access Denied: คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" });
        }
        next(); // ผ่านด่านได้!
    };
};

module.exports = checkRole;