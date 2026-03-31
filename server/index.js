import express from "express";
import cors from "cors";
import morgan from "morgan";
import { connect_db } from "./services/database.js";
import authRouter from "./routes/authRouter.js";
import scoreRouter from "./routes/scoreRouter.js";
import drawRouter from "./routes/drawRouter.js";
import charityRouter from "./routes/charityRouter.js";
import winnerRouter from "./routes/winnerRouter.js";
import adminRouter from "./routes/adminRouter.js";

import dotenv from 'dotenv';

dotenv.config();


const app = express();


app.use(morgan("dev"));
app.use(cors());


app.use(express.json());

app.use("/auth", authRouter);
app.use("/scores", scoreRouter);
app.use("/draws", drawRouter);
app.use("/charities", charityRouter);
app.use("/winners", winnerRouter);
app.use("/admin", adminRouter);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// sendEmail("preethifish@gmail.com","Test Subject", "This is a test email from the server.")
//   .then(() => console.log("Email sent successfully!"))
//   .catch((err) => console.error("Error sending email:", err));

app.listen(3000, () => {
  console.log("Server is running on port 3000");
  connect_db();
});


