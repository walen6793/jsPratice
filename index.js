const { json } = require('body-parser')
const express = require('express')
const app = express()
const mysql = require('mysql2/promise')

const { connect } = require('http2')
const bcrypt = require('bcrypt')
const { start } = require('repl')
const dotenv = require('dotenv').config();
const cors = require('cors')



const checkAPI_key = require('./middleware/checkAPI_key')
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
app.post('/check-idcard', async(req,res) => {
    try{
        let newUser = req.body
        const [check_SQL] = await db.execute('SELECT p.prefixes_nameTh, r.visitor_prefixe, r.visitor_firstname, r.visitor_lastname, r.userId AS claimed_user_id,u.id_card AS existing_user_account_id FROM user_inmate_relationship AS r LEFT JOIN user AS u ON r.visitor_id_card = u.id_card LEFT JOIN prefixes AS p ON r.visitor_prefixe = p.id_prefixes WHERE r.visitor_id_card = ?;' , [newUser.id_card])
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
                message : "ID card นี้มีบัญชีผู้ใช้แล้ว",
                id_card : check_SQL[0].id_card,
                prefixe : check_SQL[0].prefixes_nameTh ,
                firstname : check_SQL[0].visitor_firstname,
                lastname : check_SQL[0].visitor_lastname
            })
        }
        const data = check_SQL[0]
        return res.json({
            message : "ID card นี้สามารถใช้ได้",
            id_card : data.id_card,
            prefixe : data.prefixes_nameTh ,
            firstname : data.visitor_firstname,
            lastname : data.visitor_lastname
        })

    }catch (error){
        console.error(error)
        res.status(500).json({message: 'Internal Server Error'})
    }
})




app.post('/createUser',async(req,res) => {
    let connection;
    try{

        let newUser = req.body
        if (newUser.id_card == undefined || newUser.id_card.length != 13){
            return res.status(400).json({
            message : "ID card ต้องมีความยาว 13 ตัวอักษร"
            })
        }
        if (newUser.firstname == undefined || newUser.lastname == undefined || newUser.firstname.length == 0 || newUser.lastname.length == 0 || newUser.firstname.trim() == '' || newUser.lastname.trim() == ''){
            
            return res.status(400).json({
                message : "กรุณาระบุ ชื่อ-นามสกุล"
            })
        }
        if (newUser.phone == undefined || newUser.phone.length != 10) {
            return res.status(400).json({
                message : "เบอร์โทรศัพท์ต้องมีความยาว 10 ตัวอักษร"
            })
        }
        if (newUser.phone.startsWith('0' ) == false){
            
            return res.status(400).json({
                message : "เบอร์โทรศัพท์ต้องขึ้นต้นด้วยเลข 0"
            })
        }
        connection = await db.getConnection()
        console.log("ยืม "+connection.threadId)

        await connection.beginTransaction()
        console.log("เริ่มทำงาน "+connection.threadId)

        //statement หลังจากนี้ต้องสำเร็จทั้งหมดถึงจะ commit
        //ถ้าผิดพลาดตรงไหนให้ rollback

        

        //check id_card
        const [check_SQL] = await connection.execute('SELECT r.visitor_prefixe, r.visitor_firstname, r.visitor_lastname, r.userId AS claimed_user_id,u.id_card AS existing_user_account_id FROM user_inmate_relationship AS r LEFT JOIN user AS u ON r.visitor_id_card = u.id_card WHERE r.visitor_id_card = ? FOR UPDATE;' , [newUser.id_card])
        console.log("ผลลัพธ์ของการตรวจสอบ ID card: " , check_SQL);

        
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
        const [checkPhone_SQL] = await connection.execute('SELECT phone FROM user WHERE phone = ? FOR UPDATE;', [newUser.phone])
        
        if (checkPhone_SQL.length > 0){
            await connection.rollback()
            return res.status(400).json({
                message : "เบอร์โทรศัพท์นี้มีผู้ใช้แล้ว"
            })
        }
        

        //check password
        let password = newUser.password

        if (password == undefined){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค'
            })
        }
        const trimmedPassword = password.trim()
        if (trimmedPassword == ''){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password ห้ามเป็นค่าว่าง หรือ มีเว้นวรรค'
            })
        }

        if (trimmedPassword.length < 8){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password นี้ต้องมีความยาวอย่างน้อย 8 ตัวอักษร'
            })
        } if (trimmedPassword.length > 50){
            await connection.rollback()
            return res.status(400).json({
                message : 'Password ต้องมีความยาวไม่เกิน 50 ตัวอักษร'
            })
        }
        
        console.log("Password สามารถใช้ได้")
    
        console.log("ID card และ Phone สามารถใช้ได้")

        //hash password
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(trimmedPassword, saltRounds)
        


        const sql = 'INSERT INTO `visitation`.`user` (`id_card`,`prefixe_id`, `firstname`, `lastname`, `hashed_password`, `create_time`, `phone`, `is_active`, `last_active_at`) VALUES (?, ?, ?, ?, ?, NOW(), ?,1,NULL);'
        const params = [newUser.id_card,newUser.prefixe,newUser.firstname,newUser.lastname,hashedPassword,newUser.phone]
        const result = await connection.execute(sql, params)
        console.log("ผลลัพธ์การสร้างผู้ใช้ใหม่: ", result[0])

        const update_relationship_sql = 'UPDATE user_inmate_relationship SET userId = ? WHERE visitor_id_card = ?'
        const update_relationship_params = [result[0].insertId, newUser.id_card]
        const update_relationship_result  = await connection.execute(update_relationship_sql, update_relationship_params)
        
        console.log("อัปเดตความสัมพันธ์เรียบร้อย")
        await connection.commit()


        const data = result[0]
        
        return res.status(201).json({
            message : 'User created successfully',
            data : {
                id : data.insertId,
                id_card : newUser.id_card,
                prefixe : newUser.prefixe,
                firstname : newUser.firstname,
                lastname : newUser.lastname,
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