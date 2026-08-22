"""Kafka-Konsumenten (omnixys-kafka).

Hält die asynchronen Domain-/Infrastruktur-Handler, die Kafka-Topics konsumieren
(z. B. Outbox-Flush oder eingehende Ereignisse anderer Omnixys-Services).
Derzeit produziert der Chat-Service Ereignisse ausschließlich über das Analytics-Outbox.
"""
