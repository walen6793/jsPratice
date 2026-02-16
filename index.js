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


const checkAPI_key = require('./middleware/checkAPI_key')
const checkAuth = require('./middleware/checkAuth')
const ValidationError = require('./validateErr/AppError')
const { exitCode } = require('process')
const { count, time } = require('console')
const port = process.env.PORT || 8000



const initMySQLConnection = async () => {
    try{
        const dbUrl = process.env.DATABASE_URL;
        db = await mysql.createPool(dbUrl)
        }catch (error){
            console.error('Error connecting to MySQL:', error)
            process.exit(1)
    }
}
app.use(cors())
app.use(express.json()) // อ่านเป็นแบบ JSON
app.use(checkAPI_key)


app.listen(port, async () => {
    await initMySQLConnection()
    console.log(`Server is running on port ${port}`)
})




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
app.post('/check-idcard', checkAPI_key,async(req,res) => {
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
        
        const [check_SQL] = await db.execute('SELECT p.prefixes_nameTh, r.visitor_prefixe, r.visitor_firstname, r.visitor_lastname, r.userId AS claimed_user_id,u.id_card AS existing_user_account_id FROM user_inmate_relationship AS r LEFT JOIN user AS u ON r.visitor_id_card = u.id_card LEFT JOIN prefixes AS p ON r.visitor_prefixe = p.id_prefixes WHERE r.visitor_id_card = ?;' , [trimmedID_Card])
        
        if (check_SQL.length === 0){
            throw new ValidationError("ID card นี้ไม่ได้ลงทะเบียนเป็นญาติผู้ต้องขัง")
        }
        if (check_SQL[0].existing_user_account_id != null){
            
            return res.status(409).json({
                message : "ID card นี้มีบัญชีผู้ใช้แล้ว",
                id_card : trimmedID_Card,
                prefixe : check_SQL[0].prefixes_nameTh ,
                firstname : check_SQL[0].visitor_firstname,
                lastname : check_SQL[0].visitor_lastname
            })
        }
        const data = check_SQL[0]
        return res.status(200).json({
            message : "ID card นี้สามารถใช้ได้",
            id_card : data.visitor_id_card,
            prefixe : data.prefixes_nameTh ,
            firstname : data.visitor_firstname,
            lastname : data.visitor_lastname
        })

    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }
    
})




app.post('/register', checkAPI_key,async(req,res) => {
    let connection;
    let newUser = req.body
    let password = newUser.password

    try{
        
        if (newUser.id_card == undefined || newUser.id_card.length != 13){
            throw new ValidationError("ID card ต้องมีความยาว 13 ตัวอักษร")
        }
        if (newUser.firstname == undefined || newUser.lastname == undefined || newUser.firstname.length == 0 || newUser.lastname.length == 0 || newUser.firstname.trim() == '' || newUser.lastname.trim() == ''){
            throw new ValidationError("ชื่อหรือนามสกุลไม่ถูกต้อง")
        }
        
        if (password == undefined){
            throw new ValidationError('Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค')
        }

        //check password
        
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
                
        } if (trimmedPassword.length > 50){
            throw new ValidationError('Password นี้ต้องมีความยาวไม่เกิน 50 ตัวอักษร')
        }


        if (newUser.phone == undefined || newUser.phone.length != 10) {
            throw new ValidationError("เบอร์โทรศัพท์ต้องมีความยาว 10 ตัวอักษร")
        }
        if (newUser.phone.startsWith('0' ) == false){
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
        console.log("ยืม "+connection.threadId)
        await connection.beginTransaction()
        console.log("เริ่มทำงาน "+connection.threadId)


        //check id_card
        const [check_SQL] = await connection.execute('SELECT r.visitor_prefixe, r.visitor_firstname, r.visitor_lastname, r.userId AS claimed_user_id,u.id_card AS existing_user_account_id FROM user_inmate_relationship AS r LEFT JOIN user AS u ON r.visitor_id_card = u.id_card WHERE r.visitor_id_card = ? FOR UPDATE;' , [newUser.id_card])
        console.log("ผลลัพธ์ของการตรวจสอบ ID card: " , check_SQL);

        
        if (check_SQL.length === 0){
            throw new ValidationError("ID card นี้ไม่ได้ลงทะเบียนเป็นญาติผู้ต้องขัง")
        }
        if (check_SQL[0].existing_user_account_id != null){
            throw new ValidationError("ID card นี้มีบัญชีผู้ใช้แล้ว")
        }

        //checkFirstname
        if(check_SQL[0].visitor_prefixe != newUser.prefixe){
            throw new ValidationError("คำนำหน้าชื่อไม่ตรงกับที่ลงทะเบียนเป็นญาติผู้ต้องขัง")
        }
        
        if(check_SQL[0].visitor_firstname != newUser.firstname.trim()){
            throw new ValidationError("ชื่อไม่ตรงกับที่ลงทะเบียนเป็นญาติผู้ต้องขัง")
               
        }
        if(check_SQL[0].visitor_lastname != newUser.lastname.trim()){
            throw new ValidationError("นามสกุลไม่ตรงกับที่ลงทะเบียนเป็นญาติผู้ต้องขัง")
        }

    
        //checkPhone
        const [checkPhone_SQL] = await connection.execute('SELECT phone FROM user WHERE phone = ? ;', [newUser.phone])
        
        if (checkPhone_SQL.length > 0){
            throw new ValidationError("เบอร์โทรศัพท์นี้มีผู้ใช้แล้ว")
        }
        

        
        
        console.log("Password สามารถใช้ได้")
    
        console.log("ID card และ Phone สามารถใช้ได้")

        //hash password
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(trimmedPassword, saltRounds)
        


        const sql = 'INSERT INTO `visitation`.`user` (`id_card`,`prefixe_id`, `firstname`, `lastname`, `hashed_password`, `create_time`, `phone`, `is_active`, `last_active_at`) VALUES (?, ?, ?, ?, ?, NOW(), ?,1,NULL);'
        const params = [newUser.id_card,newUser.prefixe,newUser.firstname.trim(),newUser.lastname.trim(),hashedPassword,newUser.phone]
        const result = await connection.execute(sql, params)
        console.log("ผลลัพธ์การสร้างผู้ใช้ใหม่: ", result[0])

        const update_relationship_sql = 'UPDATE user_inmate_relationship SET userId = ? WHERE visitor_id_card = ?'
        const update_relationship_params = [result[0].insertId, newUser.id_card]
        const update_relationship_result  = await connection.execute(update_relationship_sql, update_relationship_params)
        if (update_relationship_result[0].affectedRows === 0){
            throw new ValidationError("ไม่สามารถอัปเดตความสัมพันธ์ได้")
        }
        
        await connection.commit()


        const data = result[0]
        
        return res.status(201).json({
            message : 'User created successfully',
            data : {
                id : data.insertId,
                id_card : newUser.id_card,
                prefixe : newUser.prefixe,
                firstname : newUser.firstname.trim(),
                lastname : newUser.lastname.trim(),
                phone : newUser.phone
            }
            

        })
        
    }catch (error){
            console.error('Error during transaction:', error)

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
                    console.log("คืน "+connection.threadId)
                }catch (err){
                    console.error('Error during release:', err)
                }
            }
    }
    
})


app.post('/login', checkAPI_key,async(req,res) => {
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

        if (device_token){
            db.execute("INSERT INTO device (user_id,device_info,device_type,last_active_at) VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), last_active_at = NOW()",[data.userId,device_token,device_type || 'unknown'])
        }
        if (update_last_active.affectedRows === 0){
            throw new ValidationError("ไม่สามารถ Update เวลาที่ใช้งานล่าสุดได้")
        }
        
        return res.json({
            message : 'Login successful',
            message2 : 'ยินดีต้อนรับ คุณ ' + data.firstname,
            id_card : data.id_card,
            token : token,
            isFirst_login : isFirst_login

        })

    }catch (error){
        console.error(error)
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
        

        
    }
})

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
        const [inmate] = await db.execute('SELECT u.userId, u.inmateId , p.prefixes_nameTh , i.firstname ,i.lastname  FROM user_inmate_relationship AS u LEFT JOIN inmate AS i ON u.inmateId = i.id LEFT JOIN prefixes AS p ON i.prefixeID = p.id_prefixes WHERE u.userId = ?',[myUserId])
        
        if (inmate.length === 0){
            res.status(200).json({
                message : 'ไม่มีข้อมูลผู้ต้องขังที่เกี่ยวข้อง',
                data : []
            })
            return
        }
        console.log("ข้อมูลผู้ต้องขังที่เกี่ยวข้อง: ", inmate)
        
        const inmateList = inmate.map(item => ({
            id : item.inmateId,
            fullname : (item.prefixes_nameTh || '') + ' ' + item.firstname + ' ' + item.lastname
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
                        SELECT n.inmate_id ,p.prefixes_nameTh, i.firstname ,i.lastname ,DATE_FORMAT(i.birthdate, '%d/%m/%Y') AS birthdate, i.blood_type,i.inmate_photo_url ,n.case_type ,DATE_FORMAT(n.admission_date, '%d/%m/%Y') AS admission_date , DATE_FORMAT(n.release_date, '%d/%m/%Y') AS release_date ,n.status ,t.inmate_type ,l.location_name ,r.prison_name, TIMESTAMPDIFF( YEAR, i.birthdate, CURDATE() ) AS age
                        FROM user_inmate_relationship AS u 
                        LEFT JOIN inmate AS i ON u.inmateId = i.id 
                        LEFT JOIN prefixes as p ON i.prefixeID =  p.id_prefixes 
                        LEFT JOIN incarcerations AS n ON n.inmate_rowID = i.id 
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
                
                inmate_type : data.inmate_type,
                location_name : data.location_name + ' / ' + data.prison_name,
                status : status_th,
                
                admission_date : data.admission_date,
                release_date : data.release_date,
                
                
                
                
            }
        })
    }catch (error){
        console.log(error)
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
        const {year,month} = req.query
        if (!year || !month){
            throw new ValidationError("กรุณาระบุ year และ month")
        }
        const [rows] = await db.execute(`
            SELECT visit_date , SUM(capacity) AS total_capacity, SUM(current_booking) AS total_booked, MAX(status) AS status
            FROM visit_slot
            WHERE YEAR(visit_date) = ? AND MONTH(visit_date) = ?
            GROUP BY visit_date
            ORDER BY visit_date ASC
        `, [year, month])
        console.log("ผลลัพธ์การดึงข้อมูลช่องเวลาการเยี่ยมชมรายเดือน: ", rows)
        const calendarData = {}

        rows.forEach(row => {
            // แปลงวันที่เป็น String '2024-11-20'
            const dateKey = row.visit_date.toISOString().split('T')[0];
            
            let status = 'AVAILABLE';
            if (row.total_booked >= row.total_capacity) {
                status = 'FULL';
            } else if (row.day_status === 'CLOSED') {
                status = 'CLOSED';
            }

            calendarData[dateKey] = {
                status: status,
                seats_left: row.total_capacity - row.total_booked
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
        const {date, type} = req.query
        if (!date || !type){
            throw new ValidationError("กรุณาระบุ date และ type")
        }
        const [rows] = await db.execute(`SELECT v.id,v.visit_date, 
            TIME_FORMAT(v.starts_at, '%H:%i') AS starts_at, 
            TIME_FORMAT(v.ends_at, '%H:%i') AS ends_at, 
            v.capacity AS capacity, 
            v.current_booking AS current_booking, 
            v.status AS status,
            d.device_name AS device_name ,d.platforms AS platforms 
            FROM visit_slot AS v 
            JOIN devices AS d ON v.device_id = d.id  
            WHERE v.visit_date = ? AND d.platforms = ? 

            ORDER BY d.device_name,v.starts_at ASC;
            `, [date,type])
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
                }else if(row.status === 'FULL' || current_booking >= capacity){
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
    const connection = await db.getConnection()
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
        await connection.beginTransaction()

        //ตรวจสอบ slot_id ว่ายังว่างไหม
        const [slotRows] = await connection.execute(`
            SELECT s.id, s.visit_date,s.current_booking, s.capacity,s.status,b.relative_user_id
            FROM visit_slot AS s LEFT JOIN visit_booking AS b ON s.id = b.slot_id AND b.relative_user_id = ?
            WHERE s.id = ? FOR UPDATE;
        `, [userId,slot_id]);
        

        
            
        if (slotRows.length === 0){
            throw new ValidationError("ไม่พบข้อมูลช่องเวลาการเยี่ยมชมที่ระบุ")
        }
        const slotData = slotRows[0]
        if (slotData.status === 'CLOSED'){
            throw new ValidationError("ช่องเวลาการเยี่ยมชมนี้ปิดรับการจองแล้ว")
        }
        if (slotData.relative_user_id == userId){
            throw new ValidationError("คุณได้ทำการจองช่องเวลาการเยี่ยมชมนี้ไปแล้ว")
        }
        console.log("ข้อมูลช่องเวลาการเยี่ยมชมที่ตรวจสอบการจอง: ", slotData)
        if (slotData.current_booking >= slotData.capacity){
            throw new ValidationError("ช่องเวลาการเยี่ยมชมนี้เต็มแล้ว")
        }
        
    //business logic ตรวจสอบการจองซ้ำ ยังไม่ได้ทำ

    const [insertResult] = await connection.execute(`
        INSERT INTO visit_booking (slot_id,inmate_id,relative_user_id)
        VALUES (?,?,?)`, [slot_id, inmate_id, userId])

    if (insertResult.affectedRows === 0){
        throw new ValidationError("ไม่สามารถสร้างการจองได้")}
    const [updateResult] = await connection.execute(`
        UPDATE visit_slot SET current_booking = current_booking + 1 WHERE id = ?
        `,[slot_id]
        )
    await connection.commit()
    res.status(201).json({
        message : 'การจองช่องเวลาการเยี่ยมชมสำเร็จ',
        booking_id : insertResult.insertId
    })

    }catch (error){
        console.log(error)
        await connection.rollback()
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }finally{
        try{
            connection.release()
        }catch (err){
            console.error('Error during release:', err)
        }
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
            d.contact_info,d.access_code,
            vb.meeting_link

            FROM visit_booking AS vb
            JOIN visit_slot AS vs ON vb.slot_id = vs.id
            JOIN inmate AS i ON vb.inmate_id = i.id
            LEFT JOIN prefixes AS p ON i.prefixeID = p.id_prefixes
            JOIN devices AS d ON vs.device_id = d.id
            LEFT JOIN incarcerations AS ic ON ic.inmate_rowID = i.id
            WHERE vb.relative_user_id = ?
            AND vb.status IN ('PENDING','APPROVED','CHECKED_IN')
            ORDER BY vs.visit_date ASC, vs.starts_at ASC

            `,[userId])
            console.log("ผลลัพธ์การตรวจสอบการจองช่องเวลาการเยี่ยมชมที่มีอยู่: ", rows)
            
            if (rows.length === 0){
                return  res.status(200).json({
                    message : 'ไม่มีการจองช่องเวลาการเยี่ยมชมที่มีอยู่',
                    data : []
                })
            }

            const bookingInfo = rows.map(row => {
                const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        return {
            booking_id : row.booking_id,
            status : row.status,
            inmate_id : row.inmate_number,
            inmate_fullname : `${row.prefixes_nameTh || ' '} ${row.firstname} ${row.lastname}`,
            date : thaiDate,
            time : `${row.starts_at} - ${row.ends_at}`,
            device_name : row.device_name,
            link : row.meeting_link || null,
            
        }
            })
            res.status(200).json({
                message : 'ข้อมูลการจองที่มีอยู่',
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
            SELECT vb.id, vb.slot_id, vb.status, vs.visit_date
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
        const visitDate = new Date(bookingData.visit_date)
        const timeDiff = visitDate.getTime() - today.getTime()
        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24))

        if (diffDays < 1){
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



app.get('/booking/:id/reschedule-preview', checkAPI_key,checkAuth, async (req,res) => {
    try{
        const user_id = req.user.userId
        const booking_id = req.params.id
        const todayTime = new Date().toLocaleDateString('en-CA', {timeZone : 'Asia/Bangkok'})


        const [bookingRows] = await db.execute(`
            SELECT ic.inmate_id,vb.id AS booking_id,i.firstname AS inmate_firstname, i.lastname AS inmate_lastname,vs.visit_date
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
                booking_id : bookingData.booking_id,
                inmate_number : bookingData.inmate_id,
                inmate_firstname : bookingData.inmate_firstname,
                inmate_lastname : bookingData.inmate_lastname
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




// app.put('/booking/:id/reschedule',checkAPI_key,checkAuth,async (req,res) => {
//     let connection;
//     try{
//         const user_id = req.user.userId
//         const booking_id = req.params.id
//         const {new_slot_id} = req.body
//         if (!new_slot_id){
//             throw new ValidationError("กรุณาระบุ new_slot_id สำหรับการเปลี่ยนรอบการเยี่ยมชม")
//         }
//         connection = await db.getConnection()
//         await connection.beginTransaction()

//     }


// })

app.get('/admin/slots', checkAPI_key,checkAuth,async (req,res) => {
    try{
        const {date} = req.query
        if (!date){
            throw new ValidationError("กรุณาระบุ date")
        }
        const [rows] = await db.execute(`
            SELECT i.firstname AS inmate_firstname, i.lastname AS inmate_lastname,
                u.firstname AS visitor_firstname, u.lastname AS visitor_lastname,
                vs.visit_date, vs.starts_at, vs.ends_at, d.device_name,

             vb.id,vb.status ,vb.meeting_link 
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
            const bookingInfo = rows.map(row => {
                
                const thaiDate = new Date(row.visit_date).toLocaleDateString('th-TH',{
                    year : 'numeric',
                    month : 'long',
                    day : 'numeric'
                })
                

                return {
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
                        meeting_link : row.meeting_link || 'ยังไม่ได้ใส่ลิงก์'

                    }
                }
            })
            res.status(200).json({
                message : 'ข้อมูลการจองช่องเวลาการเยี่ยมชมสำหรับแอดมิน',
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
app.put('/admin/slots/:id/link',checkAPI_key,checkAuth, async (req,res) => {
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
app.put('/admin/slots/:id/cancel',checkAPI_key,checkAuth, async (req,res) => {
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
            SELECT slot_id,status FROM visit_booking WHERE id = ? FOR UPDATE
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

app.post('/admin/generate-slots',checkAPI_key,checkAuth,async(req,res) => {
    let connection;
    try{
        const {year, month} = req.body
        if (!year || !month ){
            throw new ValidationError("กรุณาระบุ year และ month")
        }
        const capasity_per_slot = 1
        const timeSlots = [
            {starts_at : '09:00:00',end: '09:15:00',device_id : 5,allowed_gender : 'MALE'},
            {starts_at : '10:15:00',end: '10:30:00',device_id : 5,allowed_gender : 'MALE'},
            {starts_at : '11:15:00',end: '11:30:00',device_id : 5,allowed_gender : 'FEMALE'},
            {starts_at : '12:15:00',end: '12:30:00',device_id : 5,allowed_gender : 'MALE'},
            {starts_at : '13:15:00',end: '13:30:00',device_id : 5,allowed_gender : 'MALE'},
            {starts_at : '14:15:00',end: '14:30:00',device_id : 5,allowed_gender : 'FEMALE'},

        ]
        //คำนวณจำนวนวันในเดือน
        const daysInMonth = new Date(year,month,0).getDate()
        const bulkValues = []
        const current_booking = 0;
        const status = 'OPEN'

        //ลูป
        for (let day = 1; day <= daysInMonth; day++){
            const currentDate = new Date(year, month - 1 ,day)
            console.log("กำลังประมวลผลวันที่: ", currentDate)
            const dayOfWeek = currentDate.getDay()
            if (dayOfWeek === 0 || dayOfWeek === 6){
                continue
            }
            const dateString = currentDate.toISOString().split('T')[0];
            timeSlots.forEach(slot => {
                bulkValues.push([dateString, slot.starts_at, slot.end,capasity_per_slot,current_booking,status,slot.device_id,slot.allowed_gender])

            })
        }
        if (bulkValues.length > 0 ){
            connection = await db.getConnection()
            await connection.beginTransaction()

            await connection.query(`
                INSERT INTO visit_slot (visit_date,starts_at,ends_at,capacity,current_booking,status,device_id,allowed_gender) VALUES ?
                
                `,[bulkValues])

            await connection.commit()
            res.status(201).json({
                message : 'สร้างช่องเวลาการเยี่ยมชมสำเร็จ',
                total_slots_created : 'สร้างรอบของสำเร็จจำนวน' + bulkValues.length + 'รอบ',

            })
        }else{
            throw new ValidationError("ไม่มีวันใดในเดือนนี้ที่สามารถสร้างช่องเวลาได้")
        }
            
        
    }catch (error){
        console.log(error)
        if (connection){
            await connection.rollback()
        }
        if (error instanceof ValidationError){
            return res.status(error.statusCode).json({message: error.message})
        }
        res.status(500).json({message: 'Internal Server Error'})
    }finally{
        if (connection){
            try{
                connection.release()
                console.log("คืน "+connection.threadId)
            }catch (err){
                console.error('Error during release:', err)
            }
        }
    }
})



app.get('/users',(req,res) => {
    res.json(arr)
})

{
    "ฉีดวัคซีนแมว 240 , ตรวจค่าเลือด."
    "ฉีดวัคซีน 350"
}



app.put('/update/:id',(req,res) => {
    let id = req.params.id
    let updatedUser = req.body
    let findIndex = arr.findIndex(user => user.id == id)

    //ถ้าใช้ put ควรมีข้อมูลเดิมเพื่ออัปเดตดเมื่อไม่มีข้อมูลใหม่ด้วย เพราะมันจะอัพเดตทั้งหมด
    arr[findIndex].firstname = updatedUser.firstname || arr[findIndex].firstname
    arr[findIndex].lastname = updatedUser.lastname || arr[findIndex].lastname
    res.json({
        message : 'User updated',
        index : findIndex,
        updatedUser : arr[findIndex]
    })
    
})

app.delete('/delete/:id',(req,res) => {
    let id = req.params.id
    let findIndex = arr.findIndex(user => user.id == id)
    if (findIndex === -1){
        return res.status(404).json({message: 'User not found'})
    }
    arr.splice(findIndex,1)
    res.json({
        message : 'User deleted',
        index : findIndex
    })
})

app.get('/users/:id',(req,res) => {
    let id = req.params.id
    let findIndex = arr.findIndex(user => user.id == id)
    if (findIndex === -1){
        return res.status(404).json({
            message: 'User not found'
        })
    }
    res.json(arr[findIndex].firstname)
})