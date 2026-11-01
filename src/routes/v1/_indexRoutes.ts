import express from "express";
import connectRoutes from "./connectRoutes.js";
import whatsappRoutes from "./whatsappRoutes.js";

const router = express.Router();

router.use('/connection', connectRoutes);
router.use('/', whatsappRoutes);

export default router;
