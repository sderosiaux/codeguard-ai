# Schema Registry / Avro / Protobuf Anti-Patterns

This document catalogs common anti-patterns, bugs, and misconfigurations when working with Schema Registry, Avro, and Protobuf schemas in Kafka environments.

---

## 1. Adding Required Fields Without Defaults

**Category:** Breaking Backward Compatibility

**Description:**
Adding a new required field (without a default value) to a schema breaks backward compatibility. Consumers using the new schema cannot deserialize messages produced with the old schema because the required field is missing from old data.

**Bad Example (Avro):**
```json
// Old schema (v1)
{
  "type": "record",
  "name": "User",
  "fields": [
    {"name": "id", "type": "int"},
    {"name": "name", "type": "string"}
  ]
}

// Bad new schema (v2) - BREAKS BACKWARD COMPATIBILITY
{
  "type": "record",
  "name": "User",
  "fields": [
    {"name": "id", "type": "int"},
    {"name": "name", "type": "string"},
    {"name": "email", "type": "string"}  // Required field without default!
  ]
}
```

**Good Example (Avro):**
```json
// Good new schema (v2) - Maintains backward compatibility
{
  "type": "record",
  "name": "User",
  "fields": [
    {"name": "id", "type": "int"},
    {"name": "name", "type": "string"},
    {"name": "email", "type": "string", "default": ""}  // Default value provided
  ]
}
```

**Bad Example (Protobuf):**
```protobuf
// Old schema (v1)
message User {
  int32 id = 1;
  string name = 2;
}

// Bad new schema (v2) - BREAKS BACKWARD COMPATIBILITY
message User {
  int32 id = 1;
  string name = 2;
  string email = 3;  // No explicit optional, treated as required in proto3
}
```

**Good Example (Protobuf):**
```protobuf
// Good new schema (v2) - Maintains backward compatibility
message User {
  int32 id = 1;
  string name = 2;
  optional string email = 3;  // Explicitly optional with implicit default
}
```

**Detection Hints:**
- Schema Registry will reject the schema if BACKWARD compatibility is enabled
- Look for new fields without `default` in Avro schemas
- Look for new fields without `optional` keyword in Protobuf schemas
- Consumer exceptions: `AvroTypeException`, `SerializationException`
- Error message indicating missing required field during deserialization

---

## 2. Removing Required Fields

**Category:** Breaking Backward/Forward Compatibility

**Description:**
Removing a required field (or any field without a default value) breaks forward compatibility. Old consumers expect the field to be present and will fail when processing messages from producers using the new schema.

**Bad Example (Avro):**
```json
// Old schema (v1)
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "orderId", "type": "string"},
    {"name": "customerId", "type": "string"},
    {"name": "amount", "type": "double"}
  ]
}

// Bad new schema (v2) - BREAKS FORWARD COMPATIBILITY
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "orderId", "type": "string"},
    {"name": "customerId", "type": "string"}
    // "amount" removed without default!
  ]
}
```

**Good Example (Avro):**
```json
// Original schema (v1) - designed for evolution
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "orderId", "type": "string"},
    {"name": "customerId", "type": "string"},
    {"name": "amount", "type": "double", "default": 0.0}  // Has default
  ]
}

// Good new schema (v2) - Safe to remove field with default
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "orderId", "type": "string"},
    {"name": "customerId", "type": "string"}
    // "amount" can be safely removed because it had a default
  ]
}
```

**Bad Example (Protobuf):**
```protobuf
// Old schema (v1)
message Order {
  string order_id = 1;
  string customer_id = 2;
  double amount = 3;
}

// Bad new schema (v2) - Field removed without reservation
message Order {
  string order_id = 1;
  string customer_id = 2;
  // amount removed, field number 3 not reserved!
}
```

**Good Example (Protobuf):**
```protobuf
// Good new schema (v2) - Field number reserved
message Order {
  string order_id = 1;
  string customer_id = 2;
  // amount removed, field number reserved to prevent reuse
  reserved 3;
  reserved "amount";
}
```

**Detection Hints:**
- Consumers throw `NullPointerException` or field access errors
- Look for fields that exist in old schema but missing in new schema
- Check if removed fields had default values
- For Protobuf, check if field numbers are reserved after deletion

---

## 3. Reusing Protobuf Field Numbers

**Category:** Breaking Change - Data Corruption Risk

**Description:**
Reusing a Protobuf field number (tag) is catastrophic. Field numbers are permanent identifiers in the binary encoding. Reusing a number causes old messages to be decoded incorrectly, with data appearing in the wrong fields.

**Bad Example (Protobuf):**
```protobuf
// Old schema (v1)
message Product {
  string name = 1;
  double price = 2;
  string category = 3;
}

// Bad schema (v2) - FIELD NUMBER REUSED!
message Product {
  string name = 1;
  double price = 2;
  // Removed category (field 3)
  string manufacturer = 3;  // REUSING field number 3! CRITICAL BUG!
}
```

**What happens:** Old messages with "category=Electronics" will be decoded as "manufacturer=Electronics", corrupting data silently.

**Good Example (Protobuf):**
```protobuf
// Good schema (v2) - Field number reserved
message Product {
  string name = 1;
  double price = 2;
  reserved 3;  // Reserve the field number
  reserved "category";  // Reserve the field name
  string manufacturer = 4;  // Use new field number
}
```

**Detection Hints:**
- Look for field number reuse in schema diffs
- Data appears in unexpected fields after schema update
- Silent data corruption (no exceptions thrown)
- Search for `reserved` keyword - its absence after field deletion is a red flag
- Compare field numbers across schema versions

---

## 4. Changing Field Types Incompatibly

**Category:** Breaking Backward/Forward Compatibility

**Description:**
Changing a field's type breaks compatibility unless the change is a supported promotion (e.g., int to long in Avro). Arbitrary type changes like string to int, or long to int (demotion) cause deserialization failures or data loss.

**Bad Example (Avro) - String to Int:**
```json
// Old schema (v1)
{
  "type": "record",
  "name": "Event",
  "fields": [
    {"name": "eventId", "type": "string"},
    {"name": "userId", "type": "string"}
  ]
}

// Bad new schema (v2) - INCOMPATIBLE TYPE CHANGE
{
  "type": "record",
  "name": "Event",
  "fields": [
    {"name": "eventId", "type": "string"},
    {"name": "userId", "type": "int"}  // String to int - BREAKS!
  ]
}
```

**Bad Example (Avro) - Type Demotion:**
```json
// Old schema (v1)
{
  "type": "record",
  "name": "Metrics",
  "fields": [
    {"name": "timestamp", "type": "long"},
    {"name": "value", "type": "long"}
  ]
}

// Bad new schema (v2) - DATA LOSS!
{
  "type": "record",
  "name": "Metrics",
  "fields": [
    {"name": "timestamp", "type": "long"},
    {"name": "value", "type": "int"}  // Long to int - causes data loss!
  ]
}
```

**Good Example (Avro) - Safe Type Promotion:**
```json
// Old schema (v1)
{
  "type": "record",
  "name": "Metrics",
  "fields": [
    {"name": "timestamp", "type": "long"},
    {"name": "value", "type": "int", "default": 0}
  ]
}

// Good new schema (v2) - Safe promotion
{
  "type": "record",
  "name": "Metrics",
  "fields": [
    {"name": "timestamp", "type": "long"},
    {"name": "value", "type": "long", "default": 0}  // Int to long is safe
  ]
}
```

**Bad Example (Protobuf):**
```protobuf
// Old schema (v1)
message Transaction {
  string transaction_id = 1;
  int32 amount = 2;
}

// Bad new schema (v2) - TYPE CHANGE!
message Transaction {
  string transaction_id = 1;
  string amount = 2;  // Changed from int32 to string - BREAKS!
}
```

**Good Example (Protobuf) - Add New Field Instead:**
```protobuf
// Good new schema (v2) - Deprecate old, add new
message Transaction {
  string transaction_id = 1;
  int32 amount = 2 [deprecated = true];
  string amount_v2 = 3;  // New field with different type
}
```

**Supported Type Promotions (Avro BACKWARD mode):**
- int → long (safe)
- int → float (safe)
- int → double (safe)
- long → float (safe)
- long → double (safe)
- float → double (safe)

**Detection Hints:**
- `ClassCastException` during deserialization
- `AvroTypeException` with type mismatch message
- Data truncation or loss (long to int)
- Look for type changes in schema diffs
- Check if type change is in the supported promotions list

---

## 5. Renaming Fields Without Aliases

**Category:** Breaking Backward/Forward Compatibility

**Description:**
Renaming a field without using aliases (Avro) or maintaining the same field number (Protobuf) breaks compatibility. Old data becomes unreadable because the field name doesn't match.

**Bad Example (Avro):**
```json
// Old schema (v1)
{
  "type": "record",
  "name": "Customer",
  "fields": [
    {"name": "customerId", "type": "string"},
    {"name": "fullName", "type": "string"}
  ]
}

// Bad new schema (v2) - FIELD RENAMED WITHOUT ALIAS
{
  "type": "record",
  "name": "Customer",
  "fields": [
    {"name": "customerId", "type": "string"},
    {"name": "name", "type": "string"}  // Renamed from fullName - BREAKS!
  ]
}
```

**Good Example (Avro):**
```json
// Good new schema (v2) - Using aliases
{
  "type": "record",
  "name": "Customer",
  "fields": [
    {"name": "customerId", "type": "string"},
    {"name": "name", "type": "string", "aliases": ["fullName"]}  // Alias maintains compatibility
  ]
}
```

**Protobuf Note:**
Protobuf doesn't have this issue if field numbers remain unchanged. Field names can be changed freely as long as field numbers stay the same, because Protobuf uses field numbers for encoding.

```protobuf
// Protobuf - Field renaming is safe if number stays same
// Old schema (v1)
message Customer {
  string customer_id = 1;
  string full_name = 2;
}

// Good new schema (v2) - Field name changed, number same
message Customer {
  string customer_id = 1;
  string name = 2;  // Renamed, but field number 2 preserved - OK!
}
```

**Detection Hints:**
- Field not found errors during deserialization
- Null values for renamed fields
- Check schema diffs for name changes
- In Avro, look for missing `aliases` attribute
- In Protobuf, check if field numbers remained the same

---

## 6. Using Compatibility Mode NONE

**Category:** Configuration Anti-Pattern

**Description:**
Setting compatibility mode to NONE disables all schema validation. This allows breaking changes to be registered, causing runtime failures when producers and consumers have incompatible schema versions. Requires coordinated simultaneous upgrades of all clients.

**Bad Configuration:**
```json
// Schema Registry subject config - DANGEROUS!
{
  "compatibility": "NONE"
}
```

**What happens:**
1. Producer upgrades to schema v2 (incompatible change)
2. Old consumers can't deserialize messages - crash with `SerializationException`
3. No warning from Schema Registry during schema registration
4. Requires emergency rollback or simultaneous upgrade of all services

**Good Configuration:**
```json
// Schema Registry subject config - Safe defaults
{
  "compatibility": "BACKWARD"  // Default and recommended
}

// Or for stricter checking
{
  "compatibility": "BACKWARD_TRANSITIVE"  // Check against all versions
}

// For bidirectional safety
{
  "compatibility": "FULL"  // Both backward and forward compatible
}
```

**Example Failure Scenario:**
```json
// v1 schema
{
  "type": "record",
  "name": "Payment",
  "fields": [
    {"name": "amount", "type": "double"}
  ]
}

// v2 schema - incompatible change allowed with NONE mode
{
  "type": "record",
  "name": "Payment",
  "fields": [
    {"name": "amount", "type": "string"}  // Type changed!
  ]
}
```

With NONE mode, this schema is registered successfully, but causes:
- Old consumers crash when reading new messages
- New consumers crash when reading old messages (from topic start)
- No automatic detection or prevention

**Detection Hints:**
- Check Schema Registry configuration: `GET /config/{subject}`
- Look for `"compatibility": "NONE"` in subject or global config
- Sudden spike in `SerializationException` after schema update
- Consumer errors: `RecordDeserializationException`, `AvroTypeException`
- Producers and consumers crashing after independent deployments

**Recommended Modes:**
- **BACKWARD** (default): Safe for most use cases, allows consumer upgrades first
- **BACKWARD_TRANSITIVE**: Check against all historical versions, not just latest
- **FULL**: When both producers and consumers need flexible upgrade order
- **NEVER use NONE** in production

---

## 7. Subject Naming Strategy Mismatch with Topic

**Category:** Configuration Anti-Pattern

**Description:**
Using the wrong subject naming strategy causes schemas to be registered under unexpected subjects, leading to schema validation failures, inability to find schemas, or multiple schemas proliferating uncontrollably.

**Problem: Default TopicNameStrategy with Multiple Record Types**

**Bad Configuration:**
```java
// Producer config - using default TopicNameStrategy
props.put("value.subject.name.strategy",
  "io.confluent.kafka.serializers.subject.TopicNameStrategy");
```

**Bad Usage:**
```java
// Publishing different record types to same topic
// Subject: user-events-value (only ONE schema allowed!)
producer.send(new ProducerRecord<>("user-events", userCreatedEvent));
producer.send(new ProducerRecord<>("user-events", userUpdatedEvent));
producer.send(new ProducerRecord<>("user-events", userDeletedEvent));
```

**What happens:**
- TopicNameStrategy creates subject: `user-events-value`
- First record type (e.g., UserCreated) schema gets registered
- Second record type (e.g., UserUpdated) fails compatibility check
- Topic limited to single record type
- Schema evolution becomes inflexible

**Good Configuration - TopicRecordNameStrategy:**
```java
// Producer config - allows multiple record types per topic
props.put("value.subject.name.strategy",
  "io.confluent.kafka.serializers.subject.TopicRecordNameStrategy");
```

**Good Usage:**
```java
// Each record type gets its own subject
// Subjects: user-events-com.example.UserCreated-value
//           user-events-com.example.UserUpdated-value
//           user-events-com.example.UserDeleted-value
producer.send(new ProducerRecord<>("user-events", userCreatedEvent));
producer.send(new ProducerRecord<>("user-events", userUpdatedEvent));
producer.send(new ProducerRecord<>("user-events", userDeletedEvent));
```

**Problem: RecordNameStrategy with Different Topics**

**Bad Configuration:**
```java
// Using RecordNameStrategy across different topics
props.put("value.subject.name.strategy",
  "io.confluent.kafka.serializers.subject.RecordNameStrategy");
```

**Bad Usage:**
```java
// Same record type used in different topics
// Subject: com.example.UserEvent-value (shared across topics!)
producer.send(new ProducerRecord<>("user-events-prod", userEvent));
producer.send(new ProducerRecord<>("user-events-test", userEvent));
```

**What happens:**
- Both topics forced to use same schema version
- Can't evolve schema independently per environment
- Test environment schema changes affect production
- Lose topic-scoped schema evolution

**Subject Naming Strategy Decision Matrix:**

| Strategy | Subject Format | Use When | Avoid When |
|----------|---------------|----------|------------|
| **TopicNameStrategy** | `{topic}-value` | Single record type per topic | Multiple event types per topic |
| **RecordNameStrategy** | `{record.name}-value` | Same schema across all topics | Need per-topic schema evolution |
| **TopicRecordNameStrategy** | `{topic}-{record.name}-value` | Multiple record types, per-topic evolution | Simple single-type topics |

**Detection Hints:**
- Schema validation failures with message "Schema not found"
- Subject names don't match expectations in Schema Registry UI
- Check producer/consumer config for `value.subject.name.strategy`
- List subjects: `GET /subjects` - look for unexpected subject names
- Unbounded growth of subjects (RecordNameStrategy anti-pattern)
- UI/tooling can't find schemas (only TopicNameStrategy supported in some tools)

---

## 8. Using Slash (/) in Subject Names

**Category:** Tooling Anti-Pattern

**Description:**
Using forward slashes in subject names is technically allowed but causes severe integration problems with Maven plugins, CI/CD tools, and some UI components that treat slashes as path separators.

**Bad Example:**
```java
// Bad subject name with slash
String subjectName = "com/example/events/UserEvent-value";

// Maven plugin config requires XML escape nightmare
<configuration>
  <subjects>
    <com_x2FExample_x2FEvents_x2FUserEvent-value>
      <!-- Escaped form required -->
    </com_x2FExample_x2FEvents_x2FUserEvent-value>
  </subjects>
</configuration>
```

**Good Example:**
```java
// Good subject name with dots/dashes/underscores
String subjectName = "com.example.events.UserEvent-value";

// Maven plugin config works normally
<configuration>
  <subjects>
    <com.example.events.UserEvent-value>
      <!-- Clean, no escaping needed -->
    </com.example.events.UserEvent-value>
  </subjects>
</configuration>
```

**Problems Caused:**
1. **Maven Plugin**: Requires `_x2F` escape sequences in XML tags
2. **URL Encoding**: Slashes in REST API calls need double-encoding
3. **File Systems**: Schema export/import to files becomes problematic
4. **Scripts**: Shell scripts misinterpret slashes as path separators
5. **CI/CD**: Pipeline tools may fail parsing subject names

**Detection Hints:**
- Maven build failures with schema plugin
- REST API calls failing with 404 when subject contains `/`
- Look for pattern: `[a-zA-Z0-9._\-]+` (recommended characters)
- Avoid pattern: `[/\\]` (slashes and backslashes)
- Check subject naming conventions in code review

**Recommended Characters for Subject Names:**
- Dots: `.` (for namespacing)
- Dashes: `-` (for separators like `-key`, `-value`)
- Underscores: `_` (for word separation)
- Alphanumeric: `a-z`, `A-Z`, `0-9`

---

## 9. Not Setting Compatibility Mode (Relying on Defaults)

**Category:** Configuration Anti-Pattern

**Description:**
Not explicitly setting compatibility mode means relying on defaults, which may not match your use case. The default is BACKWARD, but this might not be known to the team, or the global default might change. This leads to unexpected schema rejection or acceptance.

**Problem Scenario:**
```java
// No compatibility mode set - using implicit default
// Team assumes FULL compatibility, but default is BACKWARD
// Forward-incompatible change gets accepted!

// Old schema
{
  "type": "record",
  "name": "Sensor",
  "fields": [
    {"name": "sensorId", "type": "string"},
    {"name": "temperature", "type": "double", "default": 0.0}
  ]
}

// New schema - removes field with default (forward incompatible)
{
  "type": "record",
  "name": "Sensor",
  "fields": [
    {"name": "sensorId", "type": "string"}
  ]
}
```

**What happens:**
- Schema Registry accepts change (BACKWARD mode allows this)
- Team expected FULL compatibility (both directions)
- Old consumers fail reading new messages
- Surprise! The default wasn't what team thought

**Good Practice - Explicit Configuration:**
```bash
# Set compatibility mode explicitly per subject
curl -X PUT http://schema-registry:8081/config/sensor-events-value \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"compatibility": "FULL"}'

# Or set global default explicitly
curl -X PUT http://schema-registry:8081/config \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"compatibility": "BACKWARD_TRANSITIVE"}'
```

**Infrastructure as Code Example:**
```yaml
# Terraform example
resource "confluent_subject_config" "orders_value" {
  schema_registry_id = confluent_schema_registry.main.id
  subject_name       = "orders-value"
  compatibility_level = "BACKWARD_TRANSITIVE"  # Explicit!
}
```

**Document in Code:**
```java
// Document expected compatibility mode in schema definition
/**
 * Order event schema.
 *
 * Compatibility Mode: BACKWARD_TRANSITIVE
 * - New fields must have defaults
 * - Cannot remove fields without defaults
 * - Must be compatible with all previous versions
 *
 * @see https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
 */
public class OrderEvent {
  // ...
}
```

**Detection Hints:**
- Check if compatibility is explicitly set: `GET /config/{subject}`
- Response with no subject-level config means using global default
- Check global default: `GET /config`
- Look for documentation of compatibility requirements in repos
- Schema changes that should fail but get accepted (or vice versa)
- Inconsistent behavior across different Schema Registry environments

**Best Practice:**
Always explicitly set compatibility mode at the subject level in your infrastructure/deployment scripts, and document the choice in your schema definitions.

---

## 10. Producer and Consumer Schema Version Mismatch (Kafka Streams)

**Category:** Architecture Anti-Pattern

**Description:**
Kafka Streams requires BACKWARD (or FULL) compatibility because consumers need to read both current input topics AND historical state stores. Using FORWARD compatibility or having version mismatches causes streams to fail when reading old state.

**Problem Scenario:**
```java
// Kafka Streams topology
StreamsBuilder builder = new StreamsBuilder();
KTable<String, UserProfile> userProfiles = builder.table("user-profiles");

// Schema evolution happens
// v1: id, name
// v2: id, name, email (with default)
// v3: id, name, email, phone (with default)

// State store contains records from v1, v2, v3
// Stream restarts and needs to read from beginning
// If FORWARD_ONLY compatibility: FAILS!
```

**What happens:**
- Kafka Streams app restarts (deployment, crash, rebalance)
- Needs to restore state from changelog topic
- Changelog contains messages from multiple schema versions
- With FORWARD compatibility: new consumer can't read old messages
- Stream fails with `SerializationException`
- State recovery impossible

**Bad Configuration:**
```java
// BAD: FORWARD compatibility with Kafka Streams
props.put(AbstractKafkaSchemaSerDeConfig.SCHEMA_REGISTRY_URL_CONFIG,
  "http://schema-registry:8081");

// Schema Registry config set to FORWARD (wrong for streams!)
// PUT /config/user-profiles-value
// {"compatibility": "FORWARD"}
```

**Good Configuration:**
```java
// GOOD: BACKWARD_TRANSITIVE compatibility
// PUT /config/user-profiles-value
// {"compatibility": "BACKWARD_TRANSITIVE"}

// Kafka Streams config
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "user-profile-processor");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(AbstractKafkaSchemaSerDeConfig.SCHEMA_REGISTRY_URL_CONFIG,
  "http://schema-registry:8081");

// State store will contain mixed versions - BACKWARD required!
KTable<String, UserProfile> profiles = builder.table(
  "user-profiles",
  Consumed.with(Serdes.String(), userProfileSerde)
);
```

**Problem: Spark Structured Streaming with Schema Mismatch**

**Bad Example:**
```scala
// Spark Structured Streaming with predefined schema
val userSchema = StructType(Array(
  StructField("id", StringType),
  StructField("name", StringType)
))

val df = spark.readStream
  .format("kafka")
  .option("kafka.bootstrap.servers", "localhost:9092")
  .option("subscribe", "users")
  .load()
  .select(from_avro(col("value"), userSchema))  // Hardcoded schema!

// Producer evolves schema to add "email" field
// Streaming query breaks because schema doesn't match!
```

**Good Example:**
```scala
// Fetch schema from Schema Registry dynamically
val schemaRegistry = new CachedSchemaRegistryClient("http://schema-registry:8081", 100)
val latestSchema = schemaRegistry.getLatestSchemaMetadata("users-value")

val df = spark.readStream
  .format("kafka")
  .option("kafka.bootstrap.servers", "localhost:9092")
  .option("subscribe", "users")
  .load()
  .select(from_avro(col("value"), latestSchema.getSchema))  // Dynamic schema!

// Or use Schema Registry format provider
val df = spark.readStream
  .format("kafka")
  .option("kafka.bootstrap.servers", "localhost:9092")
  .option("subscribe", "users")
  .option("schema.registry.url", "http://schema-registry:8081")
  .load()
```

**Detection Hints:**
- Check Kafka Streams app compatibility requirements
- `SerializationException` during state store restoration
- Errors when Kafka Streams app restarts or rebalances
- Check compatibility mode: Kafka Streams needs BACKWARD minimum
- Spark errors: "Schema mismatch" or "Field not found"
- Monitor exception rates after schema evolution:
  - `SerializationException`
  - `RecordDeserializationException`
  - `AvroTypeException`

**Compatibility Requirements by Framework:**
| Framework | Minimum Compatibility | Reason |
|-----------|----------------------|---------|
| **Kafka Streams** | BACKWARD | Reads from topic start + state stores |
| **Spark Structured Streaming** | BACKWARD | Predefined schemas + checkpoint recovery |
| **Flink** | BACKWARD | Savepoint restoration |
| **Simple Consumer** | FORWARD or BACKWARD | Depends on upgrade order |

---

## 11. Adding New Message Types in FORWARD Compatibility Mode (Protobuf)

**Category:** Protobuf-Specific Anti-Pattern

**Description:**
In Protobuf, adding a new message type to a schema is NOT forward compatible. Old consumers don't know about the new message type and can't handle it. This is especially problematic when using FORWARD or FULL compatibility modes.

**Bad Example:**
```protobuf
// Schema v1
syntax = "proto3";

message UserCreated {
  string user_id = 1;
  string name = 2;
}

// Schema v2 - NEW MESSAGE TYPE ADDED
// This BREAKS forward compatibility!
syntax = "proto3";

message UserCreated {
  string user_id = 1;
  string name = 2;
}

message UserDeleted {  // NEW MESSAGE TYPE - forward incompatible!
  string user_id = 1;
  int64 deleted_at = 2;
}
```

**What happens with FORWARD mode:**
- Producer publishes UserDeleted message using schema v2
- Old consumer (using schema v1) receives message
- Consumer doesn't recognize UserDeleted message type
- Deserialization fails or message is dropped

**Good Approach - Use BACKWARD_TRANSITIVE:**
```protobuf
// Protobuf best practice: Use BACKWARD_TRANSITIVE mode
// This allows adding new message types safely

// Set compatibility mode
// PUT /config/events-value
// {"compatibility": "BACKWARD_TRANSITIVE"}

// Schema v2 - safe to add new message type with BACKWARD mode
syntax = "proto3";

message UserCreated {
  string user_id = 1;
  string name = 2;
}

message UserDeleted {  // New message type OK with BACKWARD mode
  string user_id = 1;
  int64 deleted_at = 2;
}
```

**Alternative - Separate Topics/Subjects:**
```protobuf
// user-created-events-value subject
syntax = "proto3";
message UserCreated {
  string user_id = 1;
  string name = 2;
}

// user-deleted-events-value subject (separate!)
syntax = "proto3";
message UserDeleted {
  string user_id = 1;
  int64 deleted_at = 2;
}
```

**Detection Hints:**
- Protobuf schemas with FORWARD or FULL compatibility mode
- Check for new message type additions in schema diffs
- Consumer errors when encountering unknown message types
- Schema Registry rejects new schema with error about forward compatibility
- Best practice: Use BACKWARD_TRANSITIVE for Protobuf

**Compatibility Mode Recommendations for Protobuf:**
- **Preferred:** `BACKWARD_TRANSITIVE` (allows adding message types and fields)
- **Acceptable:** `BACKWARD` (if only checking against latest version)
- **Avoid:** `FORWARD` or `FULL` (adding message types breaks these)

---

## 12. No Default Value Validation in CI/CD

**Category:** Process Anti-Pattern

**Description:**
Not validating schemas in CI/CD before deployment means breaking changes can reach production. Schema validation should be automated as part of the build pipeline to catch compatibility issues early.

**Bad Practice - No Validation:**
```yaml
# .gitlab-ci.yml - BAD: No schema validation
build:
  script:
    - mvn clean package
    - docker build -t myapp .

deploy:
  script:
    - kubectl apply -f deployment.yaml
    # Schema gets auto-registered at runtime - too late!
```

**Good Practice - Schema Validation in CI/CD:**
```yaml
# .gitlab-ci.yml - GOOD: Validate schemas before deploy
validate-schemas:
  stage: test
  script:
    # Check schema compatibility before deployment
    - |
      for schema in schemas/*.avsc; do
        subject=$(basename "$schema" .avsc)
        curl -X POST http://schema-registry:8081/compatibility/subjects/${subject}-value/versions/latest \
          -H "Content-Type: application/vnd.schemaregistry.v1+json" \
          -d "{\"schema\": $(cat $schema | jq -Rs .)}" \
          | jq -e '.is_compatible == true' \
          || (echo "Schema $schema is not compatible!" && exit 1)
      done
  only:
    changes:
      - schemas/**/*

build:
  stage: build
  dependencies:
    - validate-schemas
  script:
    - mvn clean package

deploy:
  stage: deploy
  dependencies:
    - build
  script:
    - kubectl apply -f deployment.yaml
```

**Maven Plugin Example:**
```xml
<!-- pom.xml - Validate schemas during build -->
<plugin>
  <groupId>io.confluent</groupId>
  <artifactId>kafka-schema-registry-maven-plugin</artifactId>
  <version>7.5.0</version>
  <configuration>
    <schemaRegistryUrls>
      <param>http://schema-registry:8081</param>
    </schemaRegistryUrls>
    <subjects>
      <orders-value>src/main/avro/Order.avsc</orders-value>
    </subjects>
  </configuration>
  <executions>
    <execution>
      <id>test-compatibility</id>
      <phase>test</phase>
      <goals>
        <goal>test-compatibility</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

**Gradle Example:**
```gradle
// build.gradle - Validate schemas
plugins {
  id "com.github.imflog.kafka-schema-registry-gradle-plugin" version "1.12.0"
}

schemaRegistry {
  url = 'http://schema-registry:8081'
  compatibility {
    subject('orders-value', 'src/main/avro/Order.avsc')
  }
}

test.dependsOn('testSchemasTask')
```

**Pre-commit Hook Example:**
```bash
#!/bin/bash
# .git/hooks/pre-commit - Validate schemas before commit

SCHEMA_REGISTRY="http://localhost:8081"

for schema_file in $(git diff --cached --name-only | grep '\.avsc$'); do
  echo "Validating schema: $schema_file"

  subject=$(basename "$schema_file" .avsc)
  schema_json=$(cat "$schema_file" | jq -Rs .)

  response=$(curl -s -X POST \
    "$SCHEMA_REGISTRY/compatibility/subjects/${subject}-value/versions/latest" \
    -H "Content-Type: application/vnd.schemaregistry.v1+json" \
    -d "{\"schema\": $schema_json}")

  is_compatible=$(echo "$response" | jq -r '.is_compatible')

  if [ "$is_compatible" != "true" ]; then
    echo "ERROR: Schema $schema_file is not compatible!"
    echo "$response" | jq .
    exit 1
  fi
done

echo "All schemas are compatible!"
```

**Detection Hints:**
- Check if CI/CD pipeline includes schema validation step
- Look for `test-compatibility` goal in Maven/Gradle builds
- Schema issues discovered in production instead of CI/CD
- No pre-commit hooks for schema validation
- Auto-registration enabled in production (should be disabled)
- Check for `auto.register.schemas=false` in production configs

**Best Practices:**
1. **Validate in CI/CD:** Test compatibility before deployment
2. **Disable Auto-registration:** In production, require explicit schema registration
3. **Use Schema Registry Plugins:** Maven/Gradle plugins automate validation
4. **Pre-commit Hooks:** Catch issues before code is committed
5. **Separate Environments:** Dev Schema Registry for testing, Prod for production

---

## Detection Summary

**Key indicators of Schema Registry anti-patterns:**

1. **Exception Monitoring:**
   - `SerializationException`
   - `RecordDeserializationException`
   - `AvroTypeException`
   - `ClassCastException`
   - `NullPointerException` on field access

2. **Configuration Checks:**
   - `GET /config` and `GET /config/{subject}` - check compatibility mode
   - `GET /subjects` - check subject naming patterns
   - Look for `auto.register.schemas=true` in production

3. **Schema Analysis:**
   - Compare schema versions for type changes, field additions/removals
   - Check for `default` values on all new fields (Avro)
   - Check for `optional` keyword on new fields (Protobuf)
   - Check for `reserved` keyword after field deletions (Protobuf)
   - Look for field number reuse (Protobuf)

4. **Code Review Focus Areas:**
   - Schema evolution commits
   - Producer/consumer config changes
   - Subject naming strategy configurations
   - Compatibility mode changes

---

## References

This knowledge was compiled from the following sources:

- [Schema Evolution and Compatibility - Confluent Platform](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)
- [Practical Schema Evolution with Avro - Expedia Group Tech](https://medium.com/expedia-group-tech/practical-schema-evolution-with-avro-c07af8ba1725)
- [Schema Evolution Explained - Zeshan Anwar](https://zeshananwar.com/2018/11/26/avro-schema-evolution.html)
- [Kafka Avro Topic Naming Strategies - Ranjeet Borate](https://ranjeetborate.medium.com/kafka-avro-topic-naming-strategies-in-schema-registry-3d7b2a63f071)
- [Proto Best Practices - Protocol Buffers Documentation](https://protobuf.dev/best-practices/dos-donts/)
- [Versioning Protobuf APIs Without Breaking Clients - Java Code Geeks](https://www.javacodegeeks.com/2025/07/versioning-protobuf-apis-without-breaking-clients.html)
- [Schema evolution in Avro, Protocol Buffers and Thrift - Martin Kleppmann](https://martin.kleppmann.com/2012/12/05/schema-evolution-in-avro-protocol-buffers-thrift.html)
- [Protocol Buffers Schema Evolution Guide](https://jsontotable.org/blog/protobuf/protobuf-schema-evolution/)
- [Schema Registry 101 - Understanding Schema Subjects - Confluent Developer](https://developer.confluent.io/courses/schema-registry/schema-subjects/)
- [Schema Compatibility Pattern - Confluent Developer](https://developer.confluent.io/patterns/event-stream/schema-compatibility/)
- [Avro Schema Evolution Demystified - Laso Coder](https://laso-coder.medium.com/avro-schema-evolution-demystified-backward-and-forward-compatibility-explained-561beeaadc6b)
- [Real-Time Schema Evolution with Avro and Protobuf - Balachandra Keley](https://medium.com/@balachandra.keley/real-time-schema-evolution-with-avro-and-protobuf-ensuring-backward-compatibility-d4b96aacb4e3)
