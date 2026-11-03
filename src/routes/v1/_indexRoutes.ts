import express from "express";
import connectRoutes from "./connectRoutes.js";
import whatsappRoutes from "./whatsappRoutes.js";
import groupRoutes from "./groupRoutes.js";
import channelRoutes from "./channelRoutes.js";
import statusRoutes from "./statusRoutes.js";
import profileRoutes from "./profileRoutes.js";
import contactRoutes from "./contactRoutes.js";

const router = express.Router();

router.use('/connection', connectRoutes);
router.use('/groups', groupRoutes);
router.use('/channels', channelRoutes);
router.use('/status', statusRoutes);
router.use('/profile', profileRoutes);
router.use('/contacts', contactRoutes);
router.use('/', whatsappRoutes);

export default router;
