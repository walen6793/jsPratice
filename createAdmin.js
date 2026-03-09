const bcrypt = require('bcrypt')
const mysql = require('mysql2/promise')
const db = require('./config/db')

async function createFirstAdmin(){
    try{
        const adminInfo = {
            username : 'visitationTKP',
            password : 'Admin@1234',
            fullname : 'VISITIATION_SOMCHAI',
            role : 'VISITATION',
        }
        console.log('กำลังสร้าง Super Admin ใหม่:', adminInfo.username)

        const [existing] = await db.execute('SELECT id FROM officers WHERE username = ?', [adminInfo.username])
        if (existing.length > 0){
            console.log('พบ Super Admin ที่มีอยู่แล้ว:', adminInfo.username)
            process.exit(0)
        }
        console.log('กำลังเข้ารหหัสผ่าน')

        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(adminInfo.password, saltRounds)

        await db.execute('INSERT INTO officers (username, password,fullname,role) VALUES (?,?,?,?)',[
            adminInfo.username,
            hashedPassword,
            adminInfo.fullname,
            adminInfo.role
        ]);
        console.log('สร้าง super admin สำเร็จ :', adminInfo.username)


    }catch(error){
        console.log('เกิดข้อผิดพลาดในการสร้าง super admin :', error.message)
    }finally{
        process.exit(0)
    }


}
createFirstAdmin()