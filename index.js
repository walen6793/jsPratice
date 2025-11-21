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


const checkAPI_key = require('./middleware/checkAPI_key')
const checkAuth = require('./middleware/checkAuth')
const ValidationError = require('./validateErr/AppError')
const { exitCode } = require('process')
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