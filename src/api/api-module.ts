import { Module } from "@nestjs/common";
import { UserRepository } from "./user/user-repository"; // Adjust the path as needed
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./user/user-entity";
import { ApiService } from "./api-service";

@Module({
  imports: [TypeOrmModule.forFeature([User])], // Import TypeORM for User entity
  providers: [ApiService, UserRepository],
  exports: [ApiService], // Export ApiService for other modules
})
export class ApiModule {}
