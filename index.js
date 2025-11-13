const { json } = require('body-parser')
const express = require('express')
const app = express()
const mysql = require('mysql2/promise')



const bodyParser = require('body-parser')
const { connect } = require('http2')
const bcrypt = require('bcrypt')
const { start } = require('repl')

const dotenv = require('dotenv').config();

const port = process.env.PORT

const sql = 'SELECT * FROM app_user'
let arr = []
let counter = 0



const initMySQLConnection = async () => {
    try{
        const dbUrl = process.env.DATABASE_URL;
        db = await mysql.createPool(dbUrl)
        }catch (error){
            console.error('Error connecting to MySQL:', error)
            process.exit(1)
    }
}


app.listen(port, async () => {
    await initMySQLConnection()
    console.log(`Server is running on port ${port}`)
})

app.use(bodyParser.json()) // อ่านเป็นแบบ JSON



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
app.post('/check-idcard', async(req,res) => {
    try{
        let newUser = req.body
        const [check_SQL] = await db.execute('SELECT r.visitor_prefixe, r.visitor_firstname, r.visitor_lastname, r.userId AS claimed_user_id,u.id_card AS existing_user_account_id FROM user_inmate_relationship AS r LEFT JOIN user AS u ON r.visitor_id_card = u.id_card WHERE r.visitor_id_card = ?;' , [newUser.id_card])
        if (newUser.id_card == undefined || newUser.id_card.length != 13){
            return res.status(400).json({
            message : "ID card ต้องมีความยาว 13 ตัวอักษร"
            })
        }
        if (check_SQL.length === 0){
            return res.status(403).json({
                message : "ID card นี้ไม่ได้ลงทะเบียนเป็นญาติผู้ต้องขัง"
            })
        }
        if (check_SQL[0].existing_user_account_id != null){
            return res.status(409).json({
                message : "ID card นี้มีบัญชีผู้ใช้แล้ว"
            })
        }
        const data = check_SQL[0]
        return res.json({
            message : "ID card นี้สามารถใช้ได้",
            data : data
        })

    }catch (error){
        console.error(error)
        res.status(500).json({message: 'Internal Server Error'})
    }
})




app.post('/create',async(req,res) => {
    let connection;
    try{
        connection = await db.getConnection()
        console.log("ยืม "+connection.threadId)

        await connection.beginTransaction()
        console.log("เริ่มทำงาน "+connection.threadId)

        //statement หลังจากนี้ต้องสำเร็จทั้งหมดถึงจะ commit
        //ถ้าผิดพลาดตรงไหนให้ rollback

        let newUser = req.body

        //check id_card
        const [check_SQL] = await connection.execute('SELECT r.visitor_prefixe, r.visitor_firstname, r.visitor_lastname, r.userId AS claimed_user_id,u.id_card AS existing_user_account_id FROM user_inmate_relationship AS r LEFT JOIN user AS u ON r.visitor_id_card = u.id_card WHERE r.visitor_id_card = ? FOR UPDATE;' , [newUser.id_card])
        console.log("ผลลัพธ์ของการตรวจสอบ ID card: " , check_SQL);

        if (newUser.id_card == undefined || newUser.id_card.length != 13){
            return res.status(400).json({
            message : "ID card ต้องมีความยาว 13 ตัวอักษร"
            })
        }
        if (check_SQL.length === 0){
            await connection.rollback()
            return res.status(400).json({
                message : "ID card นี้ไม่ได้ลงทะเบียนเป็นญาติผู้ต้องขัง"
            })
        }
        if (check_SQL[0].existing_user_account_id != null){
            await connection.rollback()
            return res.status(400).json({
                message : "ID card นี้มีบัญชีผู้ใช้แล้ว"
            })
        }

        //checkFirstname
        if(check_SQL[0].visitor_prefixe != newUser.prefixe){
            await connection.rollback()
            return res.status(400).json({
                message : "คำนำหน้าชื่อไม่ตรงกับที่ลงทะเบียนเป็นญาติผู้ต้องขัง"
            })
        }
        if (newUser.firstname == undefined || newUser.lastname == undefined || newUser.firstname.length == 0 || newUser.lastname.length == 0 || newUser.firstname.trim() == '' || newUser.lastname.trim() == ''){
            await connection.rollback()
            return res.status(400).json({
                message : "กรุณาระบุ ชื่อ-นามสกุล"
            })
        }
        
        if(check_SQL[0].visitor_firstname != newUser.firstname){
            await connection.rollback()
            return res.status(400).json({
                message : "ชื่อไม่ตรงกับที่ลงทะเบียนเป็นญาติผู้ต้องขัง"
            })
        }
        if(check_SQL[0].visitor_lastname != newUser.lastname){
            await connection.rollback()
            return res.status(400).json({
                message : "นามสกุลไม่ตรงกับที่ลงทะเบียนเป็นญาติผู้ต้องขัง"
            })
        }

    
        //checkPhone
        if (newUser.phone == undefined || newUser.phone.length != 10) {
            await connection.rollback()
            return res.status(400).json({
                message : "Phone ต้องมีความยาว 10 ตัวอักษร"
            })
        }
        if (newUser.phone.startsWith('0' ) == false){
            await connection.rollback()
            return res.status(400).json({
                message : "Phone ต้องขึ้นต้นด้วยเลข 0"
            })
        }

        //check password
        let password = newUser.password.trim()

        if (password == undefined){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค'
            })
        }
        if (password.trim() == ''){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค'
            })
        }

        if (password.length < 8){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password นี้ต้องมีความยาวอย่างน้อย 8 ตัวอักษร'
            })
        } if (password.length > 50){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password ต้องมีความยาวไม่เกิน 50 ตัวอักษร'
            })
        }
        newUser.password = password
        console.log("Password สามารถใช้ได้")

        
        
    
        console.log("ID card และ Phone สามารถใช้ได้")

        //hash password
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(newUser.password, saltRounds)
        newUser.password = hashedPassword


        const sql = 'INSERT INTO `visitation`.`user` (`id_card`,`prefixe_id`, `firstname`, `lastname`, `hashed_password`, `create_time`, `phone`, `is_active`, `last_active_at`) VALUES (?, ?, ?, ?, ?, NOW(), ?,1,NULL);'
        const params = [newUser.id_card,newUser.prefixe,newUser.firstname,newUser.lastname,newUser.password,newUser.phone]
        const result = await connection.execute(sql, params)
        console.log("ผลลัพธ์การสร้างผู้ใช้ใหม่: ", result[0])

        const update_relationship_sql = 'UPDATE user_inmate_relationship SET userId = ? WHERE visitor_id_card = ?'
        const update_relationship_params = [result[0].insertId, newUser.id_card]
        await connection.execute(update_relationship_sql, update_relationship_params)
        
        console.log("อัปเดตความสัมพันธ์เรียบร้อย")
        await connection.commit()
        
    }catch (error){
            console.error('Error during transaction:', error)

            if (connection){
                try{
                    await connection.rollback()
                    
                }catch (err){
                    console.error('Error during rollback:', err)
                }
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
